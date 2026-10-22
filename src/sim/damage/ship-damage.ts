import type { Rng } from '../rng';
import type { HitGeometry, V3, Zone } from './geometry';
import type { CompartmentSpec, DamageSpec } from './spec';
import type { TraceResult } from './trace';

export type ShipStatus = 'afloat' | 'crippled' | 'struck' | 'sinking' | 'sunk' | 'exploded';
export type ReportTone = 'info' | 'warn' | 'alert' | 'critical';

export interface DamageReport {
  tone: ReportTone;
  text: string;
  /** Where it happened, ship space (for effects and for pointing the camera). */
  at?: V3;
}

export interface ShellDamageData {
  massKg: number;
  diameterMm: number;
  fillerKg: number;
}

export type TurretState = 'ok' | 'jammed' | 'destroyed' | 'no-ammo';

export interface TurretDamage {
  id: string;
  state: TurretState;
  /** Fraction of the gun crew still fit to serve. */
  crew: number;
  fire: number;
  /** Seconds until a jam is cleared (0 when not jammed). */
  jamTimer: number;
  /** The magazine that feeds it. */
  magazine: string | null;
}

/** Damage a ship carries into the fight with her: a wreck of a battleship already beaten on the day before. */
export interface Wounds {
  /** The steering gear is wrecked and cannot be repaired; the rudder stays where it was. */
  steering?: boolean;
  /** Turrets that are wrecked. */
  lostTurrets?: readonly string[];
  /** Compartments that start part flooded, each with a breach below the waterline that the parties cannot plug. */
  flooded?: readonly { comp: string; fraction: number; breachM2?: number; side?: -1 | 1 }[];
  /** The fraction of every compartment's crew still fit. */
  crew?: number;
  /** Fire control: 1 working, 0 gone. */
  fireControl?: number;
}

export interface CompartmentDamage {
  spec: CompartmentSpec;
  /** Tonnes of water aboard. */
  flood: number;
  /** Lateral position of the flood's centre, metres (positive starboard). It evens out as the compartment fills. */
  floodSide: number;
  fire: number;
  /** Structural condition, 1 sound to 0 wrecked. */
  integrity: number;
  /** Fraction of the crew still fit. */
  crew: number;
  /** How near a magazine is to going up (1 is an explosion). */
  heat: number;
  /** The magazine has been deliberately flooded to save the ship. */
  drowned: boolean;
  /** How open the bulkhead to the next compartment forward is (0 sound, 1 gone). */
  bulkheadForward: number;
}

interface Hole {
  comp: number;
  area: number;
  /** Height of the hole relative to the waterline when the ship was level, metres. */
  y: number;
  side: number;
}

/**
 * All the tunable numbers of the damage model in one place. They are chosen so that the duel plays out in minutes: a
 * hole at the waterline fills a compartment in about a minute, a serious fire takes a damage-control party a few minutes
 * to master, and a ship has to take several heavy hits in the right places to be in danger.
 */
export const TUNING = {
  /** A 12-inch shell's bursting charge, the unit of blast severity. */
  referenceFillerKg: 19,
  /** Distance at which blast has fallen to half, metres, for the reference shell. */
  blastRadius: 4.5,
  /** Hole area per square metre of calibre-squared, scaled by blast. */
  holeAreaPerCaliber: 27,
  dischargeCoefficient: 0.6,
  crewLoss: 0.3,
  integrityLoss: 0.3,
  /** Chance a burst starts a fire: flammability times (this + fireStartSeverity x severity). */
  fireStartBase: 0.12,
  fireStartSeverity: 0.3,
  fireGrowth: 0.01,
  fireExtinguishPerParty: 0.03,
  fireCrewLoss: 0.004,
  fireIntegrityLoss: 0.003,
  magazineHeatFromFire: 0.03,
  magazineCooling: 0.02,
  magazineFloodHeat: 0.7,
  magazineFloodSeconds: 25,
  waterplaneCoefficient: 0.78,
  pumpEfficiency: 1,
  crossFloodRate: 0.03,
  /** Largest hole a damage-control party can plug, m^2, and how fast each party does it, m^2 per second. */
  pluggableArea: 1.0,
  plugRate: 0.02,
  turretJamSeconds: 80,
  /** Chance a hit that fails to penetrate still jams a turret, or starts a leak in the belt (scaled by calibre squared). */
  shockJamChance: 0.12,
  /** A torpedo's breach below the belt, m^2, its blast radius, m, and how fast counter-flooding admits water, t/s. */
  torpedoHole: 7,
  /** How fast each free damage-control party shores up a breached bulkhead, openness per second. */
  shoringRate: 0.0012,
  torpedoBlastRadius: 9,
  counterFloodRate: 22,
  shockLeakChance: 0.25,
  /** A shell that cannot pierce the deck but bursts on it: filler it takes to count, and what it does below (scaled by filler / reference). */
  deckBurstMinFillerKg: 5,
  deckBurstCrewLoss: 0.2,
  deckBurstIntegrityLoss: 0.08,
  deckBurstFireChance: 0.35,
  steeringRepairSeconds: 150,
  directorRepairPerSecond: 0.0015,
  sinkAcceleration: 0.0035,
  sunkDepth: 14,
  explodedSinkAcceleration: 0.05,
} as const;

const RHO = 1.025;
const G = 9.81;

const flammability: Record<CompartmentSpec['role'], number> = {
  void: 0.15,
  magazine: 0.7,
  boiler: 0.8,
  engine: 0.55,
  steering: 0.4,
  bunker: 1.0,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** A compartment's name for use in a sentence: 'Forward boiler room' becomes 'forward boiler room', but 'A magazine' keeps its A. */
const plain = (name: string): string => (name.length > 1 && /[a-z]/.test(name[1]!) ? name[0]!.toLowerCase() + name.slice(1) : name);

/**
 * Everything that has happened to one ship. Hits arrive as traced bursts; time then does its work (water comes in, fires
 * spread and are fought, the ship heels, settles and perhaps goes down). Other systems read its outputs: the speed the
 * engines can still give, whether the rudder works, which turrets can fire, how good the fire control is.
 */
export class ShipDamage {
  readonly comps: CompartmentDamage[];
  readonly turrets: TurretDamage[];
  funnels: number[];
  /** Fire control: directors, rangefinders, plot (1 working, 0 gone). */
  fireControl = 1;
  /** Bridge and conning tower. */
  command = 1;
  status: ShipStatus = 'afloat';
  /** Whether this ship may haul down her colours: the player's never does, that is for the player to decide. */
  canStrike = true;
  torpedoHits = 0;
  /** Water let in on purpose to right a list, tonnes. */
  counterFlooded = 0;
  private counterFloodActive = false;
  /** What set the magazine off, for the debrief and for tuning. */
  explosionCause = '';
  morale = 1;
  /** Seconds since the ship began to sink, and how deep it has gone below where it floated, metres. */
  sinkTime = 0;
  sunkDepth = 0;
  /** Strike ceremony: counts down from the decision to the colours coming down. */
  private strikeIn: number | null = null;
  /** How the steering gear is: failed means the rudder is jammed where it was. */
  steeringFailed = false;
  private steeringRepair = 0;
  private sinkSign = 1;

  private readonly holes: Hole[] = [];
  /** Depth of the keel below the waterline, metres: where a grounding opens her. */
  private readonly hullDraft: number;
  private reports: DamageReport[] = [];
  private floodTotal = 0;
  private listRad = 0;
  private trimRad = 0;
  private sinkageM = 0;
  private gmEff: number;
  private readonly waterplane: number;
  private readonly crewTotal: number;
  private readonly turretsAtStart: number;
  private lastListReported = 0;
  private time = 0;
  private flooding: Map<number, number> = new Map();

  constructor(
    readonly spec: DamageSpec,
    readonly geometry: HitGeometry,
    private readonly rng: Rng,
    turretIds: readonly string[],
    hull: { length: number; beam: number; draft?: number },
    funnelCount: number,
    /** Turrets too small to count in the reckoning of how many guns are left (anti-destroyer guns, say). */
    private readonly minorTurrets: readonly string[] = [],
  ) {
    this.comps = spec.compartments.map((c) => ({
      spec: c,
      flood: 0,
      floodSide: 0,
      fire: 0,
      integrity: 1,
      crew: 1,
      heat: 0,
      drowned: false,
      bulkheadForward: 0,
    }));
    this.turrets = turretIds.map((id) => ({
      id,
      state: 'ok',
      crew: 1,
      fire: 0,
      jamTimer: 0,
      magazine: spec.compartments.find((c) => c.feeds?.includes(id))?.id ?? null,
    }));
    this.funnels = Array.from({ length: funnelCount }, () => 1);
    this.gmEff = spec.gm;
    this.waterplane = TUNING.waterplaneCoefficient * hull.length * hull.beam;
    this.hullDraft = hull.draft ?? 6;
    this.crewTotal = spec.compartments.reduce((s, c) => s + c.crew, 0);
    this.turretsAtStart = turretIds.filter((id) => !minorTurrets.includes(id)).length;
  }

  // ---- outputs ---------------------------------------------------------------------------------

  get list(): number {
    return this.listRad;
  }
  get trim(): number {
    return this.trimRad;
  }
  /** How far the ship has settled in the water, metres. */
  get sinkage(): number {
    return this.sinkageM + this.sunkDepth;
  }
  get floodedTonnes(): number {
    return this.floodTotal;
  }
  get crewFraction(): number {
    let alive = 0;
    for (const c of this.comps) alive += c.spec.crew * c.crew;
    return alive / this.crewTotal;
  }
  get alive(): boolean {
    return this.status !== 'sunk' && this.status !== 'exploded';
  }
  get floating(): boolean {
    return this.status === 'afloat' || this.status === 'crippled' || this.status === 'struck';
  }

  private health(c: CompartmentDamage): number {
    const flooded = c.flood / c.spec.capacityT;
    if (flooded > 0.6) return 0;
    return c.integrity * clamp(c.crew / 0.4, 0, 1) * (1 - flooded * 0.8);
  }

  /** Fraction of full propulsion the machinery can still give. */
  get power(): number {
    let boilers = 0;
    let boilerShare = 0;
    let engines = 1;
    for (const c of this.comps) {
      const share = c.spec.power ?? 0;
      if (share <= 0) continue;
      if (c.spec.role === 'boiler') {
        boilers += share * this.health(c);
        boilerShare += share;
      } else if (c.spec.role === 'engine') {
        engines = Math.min(engines, this.health(c));
      }
    }
    const boilerFrac = boilerShare > 0 ? boilers / boilerShare : 1;
    const funnel = this.funnels.length > 0 ? 1 - 0.12 * this.funnels.filter((f) => f < 0.5).length : 1;
    return clamp(Math.min(boilerFrac, engines) * funnel, 0, 1);
  }

  /** Multiplier on the ship's speed: machinery, then how far down she is in the water and whether she is sinking. */
  get speedFactor(): number {
    if (!this.floating) return 0;
    if (this.status === 'struck') return 0;
    const settle = 1 - 0.45 * clamp(this.sinkageM / 2.5, 0, 1);
    return this.power * settle;
  }

  turretAvailable(id: string): boolean {
    const t = this.turrets.find((x) => x.id === id);
    return !!t && t.state === 'ok' && t.crew >= 0.25 && this.floating;
  }

  /** How much slower a turret reloads for want of men. */
  turretReloadFactor(id: string): number {
    const t = this.turrets.find((x) => x.id === id);
    return t ? 1 / clamp(t.crew, 0.3, 1) : 1;
  }

  get turretsLost(): number {
    return this.turrets.filter((t) => !this.minorTurrets.includes(t.id) && (t.state === 'destroyed' || t.state === 'no-ammo' || t.crew < 0.25)).length;
  }

  get fires(): number {
    return this.comps.filter((c) => c.fire > 0.05).length + this.turrets.filter((t) => t.fire > 0.05).length;
  }

  drainReports(): DamageReport[] {
    const r = this.reports;
    this.reports = [];
    return r;
  }

  private report(tone: ReportTone, text: string, at?: V3): void {
    this.reports.push({ tone, text, at });
  }

  // ---- hits ------------------------------------------------------------------------------------

  private compIndexAtX(x: number): number {
    const i = this.comps.findIndex((c) => x >= c.spec.x0 && x <= c.spec.x1);
    if (i >= 0) return i;
    return x < 0 ? 0 : this.comps.length - 1;
  }

  /** Apply the result of a shell's passage through the ship. */
  applyTrace(r: TraceResult, shell: ShellDamageData): void {
    if (!this.alive) return;
    switch (r.kind) {
      case 'ricochet':
        this.report('info', 'A shell glanced off the armour.', r.at);
        return;
      case 'shatter':
        this.spall(r, shell);
        return;
      case 'pass':
        this.touch(r, shell);
        return;
      case 'burst':
        this.burst(r, shell);
    }
  }

  /** A shell that broke on armour: no burst inside, but the blow and the splinters hurt the men behind it. */
  private spall(r: TraceResult, shell: ShellDamageData): void {
    const comp = this.comps[this.compIndexAtX(r.at[0])]!;
    const sev = 0.06 * (shell.diameterMm / 305) ** 2;
    comp.crew = clamp(comp.crew - sev * 0.5, 0, 1);
    const kind = r.stoppedBy?.kind;
    const k = (shell.diameterMm / 305) ** 2;
    if (kind === 'turret-face' || kind === 'turret-side' || kind === 'turret-roof') {
      const t = this.turrets.find((x) => r.stoppedBy?.component === `turret:${x.id}`);
      if (t) {
        t.crew = clamp(t.crew - 0.12 * k, 0, 1);
        // The blow can jam the training gear or the guns in their cradles even when nothing comes through.
        if (t.state === 'ok' && this.rng.next() < TUNING.shockJamChance * k) {
          t.state = 'jammed';
          t.jamTimer = TUNING.turretJamSeconds;
          this.report('alert', `Turret ${t.id} is jammed by the shock of a hit.`, r.at);
          return;
        }
      }
    } else if (kind === 'deck' && shell.fillerKg >= TUNING.deckBurstMinFillerKg) {
      // A heavy shell that falls on the deck from above and cannot go through it bursts there: the blast and splinters come
      // down the hatches and ventilators, and what it sets alight burns on the deck above the compartment.
      const sev0 = shell.fillerKg / TUNING.referenceFillerKg;
      comp.crew = clamp(comp.crew - TUNING.deckBurstCrewLoss * sev0, 0, 1);
      comp.integrity = clamp(comp.integrity - TUNING.deckBurstIntegrityLoss * sev0, 0, 1);
      if (this.rng.next() < Math.min(TUNING.deckBurstFireChance * sev0, 0.9)) comp.fire = Math.max(comp.fire, 0.2);
      this.report('alert', `A heavy shell bursts on the deck above the ${plain(comp.spec.name)}.`, r.at);
      return;
    } else if ((kind === 'belt' || kind === 'side') && r.entry[1] > -2 && r.entry[1] < 0.6) {
      // A blow on the belt starts seams and rivets: a small leak at the waterline.
      if (this.rng.next() < TUNING.shockLeakChance * k) {
        const idx = this.compIndexAtX(r.entry[0]);
        this.holes.push({ comp: idx, area: 0.3 * k, y: Math.min(r.entry[1], 0), side: Math.sign(r.entry[2]) || 1 });
        this.report('warn', `The belt is started by a hit: a leak in the ${plain(this.comps[idx]!.spec.name)}.`, r.at);
        return;
      }
    }
    this.report('info', 'A shell broke up against our armour.', r.at);
  }

  /** A shell through light structure only: it can wreck a funnel or the mast head on its way. */
  private touch(r: TraceResult, shell: ShellDamageData): void {
    const k = (shell.diameterMm / 305) ** 2;
    for (const p of r.crossed) {
      const c = p.component ?? '';
      if (c.startsWith('funnel:')) {
        const i = Number(c.slice(7));
        if (this.funnels[i] !== undefined && this.funnels[i]! > 0.5) {
          this.funnels[i] = clamp(this.funnels[i]! - 0.3 * k, 0, 1);
          if (this.funnels[i]! < 0.5) this.report('warn', `Funnel ${i + 1} is shot through: draught is falling.`, r.at);
        }
      } else if (c.startsWith('director:')) {
        this.fireControl = clamp(this.fireControl - 0.35 * k, 0, 1);
        this.report('alert', 'The mast head is hit: fire control is damaged.', r.at);
      } else if (c.startsWith('bridge:')) {
        this.command = clamp(this.command - 0.1 * k, 0, 1);
      }
    }
  }

  private burst(r: TraceResult, shell: ShellDamageData): void {
    const zone = r.zone!;
    const sev0 = (shell.fillerKg / TUNING.referenceFillerKg) * (this.spec.fragility ?? 1);
    const at = r.at;
    switch (zone.kind) {
      case 'turret':
        this.hitTurret(zone.ref, sev0, at);
        break;
      case 'barbette':
        this.hitBarbette(zone.ref, sev0, at);
        break;
      case 'funnel': {
        const i = Number(zone.ref.slice(7));
        if (this.funnels[i] !== undefined) this.funnels[i] = clamp(this.funnels[i]! - 0.6 * sev0, 0, 1);
        this.report('warn', `Hit on funnel ${i + 1}.`, at);
        this.touch({ ...r, crossed: r.crossed.filter((p) => p.component?.startsWith('funnel:')) }, shell);
        break;
      }
      case 'bridge':
        this.command = clamp(this.command - 0.4 * sev0, 0, 1);
        this.fireControl = clamp(this.fireControl - 0.15 * sev0, 0, 1);
        this.report('alert', 'The bridge has been hit.', at);
        break;
      case 'conning':
        this.command = clamp(this.command - 0.5 * sev0, 0, 1);
        this.report('alert', 'The conning tower has been hit.', at);
        break;
      case 'director':
        this.fireControl = clamp(this.fireControl - 0.7 * sev0, 0, 1);
        this.report('critical', 'The fire-control position is hit!', at);
        break;
      case 'compartment':
        this.hitCompartment(zone, r, shell, sev0);
        break;
    }
    if (zone.kind !== 'compartment' && zone.kind !== 'barbette') {
      // A burst in the upperworks still showers the deck: a little fire risk and casualties in the compartments below.
      const below = this.comps[this.compIndexAtX(at[0])]!;
      below.crew = clamp(below.crew - 0.04 * sev0, 0, 1);
    }
  }

  private hitCompartment(zone: Zone, r: TraceResult, shell: ShellDamageData, sev0: number): void {
    const at = r.at;
    const primary = this.comps.findIndex((c) => c.spec.id === zone.ref);
    const radius = TUNING.blastRadius * Math.cbrt(Math.max(shell.fillerKg, 0.5) / TUNING.referenceFillerKg);
    this.blast(at, primary, sev0, radius);

    // The hole the shell made going in, if it went in at or below the waterline.
    const entry = r.entry;
    if (entry[1] < 0.5 && (r.first.axis === 2 || r.first.axis === 1)) {
      const idx = this.compIndexAtX(entry[0]);
      const area = TUNING.holeAreaPerCaliber * (shell.diameterMm / 1000) ** 2 * (0.6 + sev0);
      this.holes.push({ comp: idx, area, y: entry[1], side: Math.sign(entry[2]) || 1 });
      const c = this.comps[idx]!;
      this.report('critical', `Holed below the waterline in the ${plain(c.spec.name)}. Flooding.`, entry);
    } else {
      const c = this.comps[primary >= 0 ? primary : this.compIndexAtX(at[0])]!;
      this.report('alert', `Hit in the ${plain(c.spec.name)}.`, at);
    }
  }

  /** The blast of a burst at `at`: felt in the compartment it is in and, fading with distance, through the bulkheads. */
  private blast(at: V3, primary: number, sev0: number, radius: number): void {
    this.comps.forEach((c, i) => {
      // Distance from the burst to this compartment's span along the ship.
      const d = at[0] < c.spec.x0 ? c.spec.x0 - at[0] : at[0] > c.spec.x1 ? at[0] - c.spec.x1 : 0;
      const sev = i === primary ? sev0 : (sev0 * 1) / (1 + (d / radius) ** 2) * (d < 4 * radius ? 1 : 0);
      if (sev < 0.05) return;
      this.damageCompartment(i, sev, i === primary, at);
      if (i !== primary && sev > 0.3) {
        // The bulkhead between is breached: water passes forward and aft.
        const lo = Math.min(i, primary);
        this.comps[lo]!.bulkheadForward = clamp(this.comps[lo]!.bulkheadForward + Math.min((sev - 0.3) * 0.5, 0.35), 0, 0.7);
      }
    });
  }

  /**
   * She runs onto the bottom at `speed` m/s, `x` metres forward of amidships: the bottom plates are started where she struck and
   * she makes water. A gentle touch is a scrape; a hard one opens a hole damage control cannot plug.
   */
  applyGrounding(x: number, speed: number): void {
    if (!this.alive || speed < 1) return;
    const severity = Math.min(speed / 6, 1.5);
    const idx = this.compIndexAtX(x);
    const area = 0.15 + 1.1 * severity * severity;
    this.holes.push({ comp: idx, area, y: -(this.hullDraft - 0.5), side: x >= 0 ? 1 : -1 });
    const c = this.comps[idx]!;
    c.integrity = clamp(c.integrity - 0.1 * severity, 0, 1);
    this.report(speed > 3 ? 'critical' : 'alert', speed > 3 ? `Aground! The bottom is torn open in the ${plain(c.spec.name)}.` : `We have touched bottom: a leak in the ${plain(c.spec.name)}.`);
  }

  /** A torpedo strikes: a great breach below the belt, and a blast that reaches the compartments either side. */
  applyTorpedo(hit: { x: number; side: 1 | -1; depth: number; warheadKg: number; cause?: 'mine' }): void {
    if (!this.alive) return;
    const protection = this.spec.torpedoProtection ?? 0;
    const sev0 = clamp(hit.warheadKg / 45, 0, 3) * (1 - 0.6 * protection);
    const hb = this.geometry.hull.halfBreadth(hit.x);
    const at: V3 = [hit.x, -hit.depth, hit.side * hb];
    const primary = this.compIndexAtX(hit.x);
    this.blast(at, primary, sev0, TUNING.torpedoBlastRadius);
    const area = TUNING.torpedoHole * (1 - 0.5 * protection);
    this.holes.push({ comp: primary, area, y: -hit.depth, side: hit.side });
    this.torpedoHits++;
    this.report('critical', `${hit.cause === 'mine' ? 'We have struck a mine!' : 'Torpedo hit!'} The ${plain(this.comps[primary]!.spec.name)} is holed and flooding.`, at);
  }

  private damageCompartment(i: number, sev: number, primary: boolean, at: V3): void {
    const c = this.comps[i]!;
    const role = c.spec.role;
    c.crew = clamp(c.crew - TUNING.crewLoss * sev, 0, 1);
    c.integrity = clamp(c.integrity - TUNING.integrityLoss * sev, 0, 1);
    const pFire = clamp(flammability[role] * (TUNING.fireStartBase + TUNING.fireStartSeverity * sev), 0, 0.95);
    if (this.rng.next() < pFire) {
      const was = c.fire;
      c.fire = clamp(c.fire + 0.25 + 0.4 * sev, 0, 1);
      if (was < 0.05) this.report('alert', `Fire in the ${plain(c.spec.name)}.`, at);
    }
    if (role === 'magazine') {
      c.heat = clamp(c.heat + 0.35 * sev * (1 - this.spec.flashProtection), 0, 2);
      if (primary && sev > 0.4 && this.rng.next() < 0.055 * sev * (1 - this.spec.flashProtection)) this.explode(c.spec.name, 'burst in magazine');
    }
    if (role === 'steering' && c.integrity <= 0.75 && !this.steeringFailed) this.failSteering();
    if ((role === 'boiler' || role === 'engine') && primary && c.integrity < 0.6) {
      this.report('warn', `The ${plain(c.spec.name)} is badly damaged: speed is falling.`, at);
    }
  }

  private hitTurret(id: string, sev0: number, at: V3): void {
    const t = this.turrets.find((x) => x.id === id);
    if (!t) return;
    t.crew = clamp(t.crew - 0.85 * sev0, 0, 1);
    t.fire = clamp(t.fire + 0.5, 0, 1);
    if (this.rng.next() < clamp(0.45 + 0.4 * sev0, 0, 0.95)) {
      t.state = 'destroyed';
      this.report('critical', `Turret ${id} is wrecked and out of action!`, at);
    } else {
      t.state = 'jammed';
      t.jamTimer = TUNING.turretJamSeconds;
      this.report('alert', `Turret ${id} is hit and jammed.`, at);
    }
    // Cordite in the turret and the handing room: the flash may run down the hoist.
    const mag = this.comps.find((c) => c.spec.id === t.magazine);
    if (mag) {
      mag.heat = clamp(mag.heat + 0.2 * (1 - this.spec.flashProtection), 0, 2);
      if (this.rng.next() < 0.02 * (1 - this.spec.flashProtection)) this.explode(mag.spec.name, 'flash from turret');
    }
  }

  private hitBarbette(id: string, sev0: number, at: V3): void {
    const t = this.turrets.find((x) => x.id === id);
    const mag = this.comps.find((c) => c.spec.feeds?.includes(id));
    this.report('critical', `A shell has burst in turret ${id}'s barbette!`, at);
    if (t) {
      t.crew = clamp(t.crew - 0.6 * sev0, 0, 1);
      t.fire = clamp(t.fire + 0.4, 0, 1);
      if (t.state === 'ok') {
        t.state = 'jammed';
        t.jamTimer = TUNING.turretJamSeconds;
      }
    }
    if (mag) {
      mag.heat = clamp(mag.heat + 0.5 * sev0 * (1 - this.spec.flashProtection), 0, 2);
      if (this.rng.next() < 0.05 * sev0 * (1 - this.spec.flashProtection)) this.explode(mag.spec.name, 'flash down barbette');
    }
  }

  private explode(where: string, cause: string): void {
    if (this.status === 'exploded') return;
    this.status = 'exploded';
    this.explosionCause = cause;
    this.sinkTime = 0;
    this.report('critical', `The ${plain(where)} has blown up!`);
  }

  private failSteering(): void {
    this.steeringFailed = true;
    this.steeringRepair = TUNING.steeringRepairSeconds;
    this.report('critical', 'The steering gear is wrecked: the rudder is jammed.');
  }

  /** Begin the fight already hurt: see `Wounds`. */
  wound(w: Wounds): void {
    if (w.steering) {
      this.steeringFailed = true;
      this.steeringRepair = Number.POSITIVE_INFINITY;
    }
    for (const id of w.lostTurrets ?? []) {
      const t = this.turrets.find((x) => x.id === id);
      if (!t) continue;
      t.state = 'destroyed';
      t.crew = 0;
    }
    for (const f of w.flooded ?? []) {
      const i = this.comps.findIndex((c) => c.spec.id === f.comp);
      if (i < 0) continue;
      const c = this.comps[i]!;
      c.flood = c.spec.capacityT * clamp(f.fraction, 0, 1);
      c.floodSide = (f.side ?? 0) * 5.5;
      if (f.breachM2) this.holes.push({ comp: i, area: f.breachM2, y: -3, side: f.side ?? 0 });
    }
    this.floodTotal = this.comps.reduce((sum, c) => sum + c.flood, 0);
    if (w.crew !== undefined) for (const c of this.comps) c.crew = clamp(w.crew, 0, 1);
    if (w.fireControl !== undefined) this.fireControl = clamp(w.fireControl, 0, 1);
  }

  /** A turret jams of itself (a quadruple mounting's mechanism, say): it is out of action until the crew clear it. */
  jamTurret(id: string, seconds: number, text = 'has jammed'): void {
    const t = this.turrets.find((x) => x.id === id);
    if (!t || t.state !== 'ok') return;
    t.state = 'jammed';
    t.jamTimer = seconds;
    this.report('alert', `Turret ${id} ${text}.`);
  }

  // ---- time ------------------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    if (this.status === 'sunk') return;
    if (this.status === 'exploded') {
      this.sinkTime += dt;
      this.sunkDepth += 0.5 * TUNING.explodedSinkAcceleration * (2 * this.sinkTime + dt) * dt;
      if (this.sunkDepth > TUNING.sunkDepth) this.status = 'sunk';
      return;
    }
    if (this.status === 'sinking') {
      this.stepSinking(dt);
      return;
    }
    this.flood(dt);
    this.counterFlood(dt);
    this.fire(dt);
    this.machinery(dt);
    this.stability();
    this.assess(dt);
  }

  private flood(dt: number): void {
    // Water through the holes.
    this.flooding.clear();
    for (const h of this.holes) {
      const c = this.comps[h.comp]!;
      const room = c.spec.capacityT - c.flood;
      if (room <= 0) continue;
      const head = Math.max(0, -h.y + this.sinkageM + Math.abs(this.listRad) * 3);
      if (head <= 0) continue;
      const flow = TUNING.dischargeCoefficient * h.area * Math.sqrt(2 * G * head) * RHO;
      const dm = Math.min(flow * dt, room);
      const before = c.flood;
      c.flood += dm;
      c.floodSide = (c.floodSide * before + h.side * 5.5 * dm) / Math.max(c.flood, 1e-6);
      this.flooding.set(h.comp, (this.flooding.get(h.comp) ?? 0) + dm / dt);
    }
    // Through damaged bulkheads, from the fuller compartment to the emptier.
    for (let i = 0; i + 1 < this.comps.length; i++) {
      const a = this.comps[i]!;
      const b = this.comps[i + 1]!;
      const open = a.bulkheadForward;
      if (open <= 0.02) continue;
      const fa = a.flood / a.spec.capacityT;
      const fb = b.flood / b.spec.capacityT;
      const move = TUNING.crossFloodRate * open * (fa - fb) * Math.min(a.spec.capacityT, b.spec.capacityT) * dt;
      const m = clamp(move, -b.flood, a.flood);
      a.flood -= m;
      b.flood += m;
    }
    // Pumps: the most flooded compartments first, as far as the machinery to drive them lasts.
    let pump = this.spec.pumpTonnesPerSecond * TUNING.pumpEfficiency * this.power * dt;
    if (pump > 0) {
      const order = [...this.comps].filter((c) => c.flood > 0).sort((a, b) => b.flood / b.spec.capacityT - a.flood / a.spec.capacityT);
      for (const c of order) {
        if (pump <= 0) break;
        const take = Math.min(pump, c.flood);
        c.flood -= take;
        pump -= take;
      }
    }
    // Damage-control parties plug small holes when they are not fighting fire. A breach a heavy shell makes is beyond them,
    // but they can shore up the bulkheads around it, which slows the water's spread to the next compartments.
    const free = this.freeParties();
    if (free > 0) {
      for (const c of this.comps) c.bulkheadForward = Math.max(0, c.bulkheadForward - free * TUNING.shoringRate * dt);
      const small = this.holes.filter((h) => h.area <= TUNING.pluggableArea);
      for (const h of small) h.area = Math.max(0, h.area - (free * TUNING.plugRate * dt) / small.length);
      for (let i = this.holes.length - 1; i >= 0; i--) if (this.holes[i]!.area < 0.02) this.holes.splice(i, 1);
    }
    this.floodTotal = 0;
    for (const c of this.comps) {
      c.flood = clamp(c.flood, 0, c.spec.capacityT);
      this.floodTotal += c.flood;
      // A compartment that is solid with water puts its fire out and drowns a magazine's heat.
      if (c.flood / c.spec.capacityT > 0.4) c.fire = Math.max(0, c.fire - 0.08 * dt);
    }
  }

  /**
   * Counter-flooding: when the list gets serious the damage-control party opens valves on the other side to bring her upright,
   * spending some of her reserve of buoyancy to keep her from rolling over.
   */
  private counterFlood(dt: number): void {
    const limit = this.spec.counterFloodT ?? 1500;
    const list = this.listRad;
    if (!this.counterFloodActive && Math.abs(list) > 5 * (Math.PI / 180) && this.counterFlooded < limit && this.crewFraction > 0.2) {
      this.counterFloodActive = true;
      this.report('warn', 'Counter-flooding to right the list.');
    }
    if (this.counterFloodActive && (Math.abs(list) < 1.5 * (Math.PI / 180) || this.counterFlooded >= limit)) this.counterFloodActive = false;
    if (!this.counterFloodActive) return;
    // Water goes into the emptiest suitable compartment on the side opposite the list.
    const side = list > 0 ? -1 : 1;
    let best: CompartmentDamage | null = null;
    for (const c of this.comps) {
      if (c.spec.role === 'magazine' || c.spec.role === 'steering' || c.fire > 0.1) continue;
      const f = c.flood / c.spec.capacityT;
      if (f > 0.8) continue;
      if (best === null || f < best.flood / best.spec.capacityT) best = c;
    }
    if (!best) return;
    const dm = Math.min(TUNING.counterFloodRate * dt, best.spec.capacityT - best.flood, limit - this.counterFlooded);
    if (dm <= 0) return;
    const before = best.flood;
    best.flood += dm;
    best.floodSide = (best.floodSide * before + side * 5.5 * dm) / best.flood;
    this.counterFlooded += dm;
  }

  /** Parties left over after the fires have taken theirs. */
  private freeParties(): number {
    const total = Math.round(this.spec.parties * clamp(this.crewFraction / 0.7, 0, 1));
    return Math.max(0, total - this.fires);
  }

  private fire(dt: number): void {
    // Parties go to the worst fires first, with magazines and their turrets ahead of the rest.
    const burning: { f: { fire: number }; weight: number }[] = [];
    this.comps.forEach((c) => c.fire > 0.02 && burning.push({ f: c, weight: c.fire * (c.spec.role === 'magazine' ? 2 : 1) }));
    this.turrets.forEach((t) => t.fire > 0.02 && burning.push({ f: t, weight: t.fire * 1.2 }));
    burning.sort((a, b) => b.weight - a.weight);
    const parties = Math.round(this.spec.parties * clamp(this.crewFraction / 0.7, 0, 1));
    burning.forEach((b, rank) => {
      const fighting = rank < parties;
      const f = b.f;
      const growth = TUNING.fireGrowth * (1 - f.fire);
      const out = fighting ? TUNING.fireExtinguishPerParty : 0;
      f.fire = clamp(f.fire + (growth - out) * dt, 0, 1);
      if (f.fire < 0.02) {
        f.fire = 0;
        const c = f as CompartmentDamage;
        if (c.spec) this.report('info', `The fire in the ${plain(c.spec.name)} is out.`);
      }
    });

    this.comps.forEach((c, i) => {
      if (c.fire > 0) {
        c.crew = clamp(c.crew - TUNING.fireCrewLoss * c.fire * dt, 0, 1);
        c.integrity = clamp(c.integrity - TUNING.fireIntegrityLoss * c.fire * dt, 0, 1);
        // It spreads to its neighbours.
        for (const j of [i - 1, i + 1]) {
          const n = this.comps[j];
          if (!n) continue;
          if (c.fire > 0.5 && n.fire < 0.05 && this.rng.next() < 0.01 * c.fire * flammability[n.spec.role] * dt) {
            n.fire = 0.15;
            this.report('alert', `The fire has spread to the ${plain(n.spec.name)}.`);
          }
        }
      }
      if (c.spec.role === 'magazine') {
        const turretFire = this.turrets.filter((t) => t.magazine === c.spec.id).reduce((m, t) => Math.max(m, t.fire), 0);
        const adjacent = Math.max(this.comps[i - 1]?.fire ?? 0, this.comps[i + 1]?.fire ?? 0) * 0.5;
        const heating = Math.max(c.fire, turretFire * 0.8, adjacent);
        if (c.drowned || c.flood / c.spec.capacityT > 0.7) {
          c.heat = Math.max(0, c.heat - 0.2 * dt);
        } else if (heating > 0.05) {
          c.heat += TUNING.magazineHeatFromFire * heating * dt;
          // The magazine crew flood it when it gets dangerously hot: the ship is saved, those guns are not.
          if (c.heat > TUNING.magazineFloodHeat && this.freeParties() + parties > 0 && !c.drowned) {
            c.drowned = true;
            this.report('alert', `Flooding the ${plain(c.spec.name)} to prevent an explosion.`);
          }
        } else {
          c.heat = Math.max(0, c.heat - TUNING.magazineCooling * dt);
        }
        if (c.drowned) {
          c.flood = Math.min(c.spec.capacityT, c.flood + (c.spec.capacityT / TUNING.magazineFloodSeconds) * dt);
          c.fire = Math.max(0, c.fire - 0.15 * dt);
        }
        if (c.heat >= 1 && !c.drowned) this.explode(c.spec.name, 'fire reached the magazine');
      }
    });

    for (const t of this.turrets) {
      if (t.fire > 0) {
        t.crew = clamp(t.crew - 0.01 * t.fire * dt, 0, 1);
      }
    }
  }

  private machinery(dt: number): void {
    for (const t of this.turrets) {
      if (t.state === 'jammed') {
        t.jamTimer -= dt * clamp(t.crew, 0.2, 1);
        if (t.jamTimer <= 0 && t.crew >= 0.3) {
          t.state = 'ok';
          t.jamTimer = 0;
          this.report('info', `Turret ${t.id} is back in action.`);
        }
      }
    }
    // A magazine that is flooded (or has been flooded on purpose) leaves the turrets it feeds with no ammunition: one report
    // for the magazine, not one for each gun.
    for (const mag of this.comps) {
      if (mag.spec.role !== 'magazine' || !(mag.drowned || mag.flood / mag.spec.capacityT > 0.5)) continue;
      const starved = this.turrets.filter((t) => t.magazine === mag.spec.id && t.state !== 'no-ammo' && t.state !== 'destroyed');
      if (starved.length === 0) continue;
      for (const t of starved) t.state = 'no-ammo';
      const names = starved.length <= 3 ? `turret${starved.length > 1 ? 's' : ''} ${starved.map((t) => t.id).join(', ')}` : `${starved.length} guns`;
      this.report('warn', `The ${plain(mag.spec.name)} is flooded: ${names} out of ammunition.`);
    }
    if (this.steeringFailed) {
      const s = this.comps.find((c) => c.spec.role === 'steering');
      const hampered = s ? s.fire > 0.3 || s.flood / s.spec.capacityT > 0.5 : false;
      this.steeringRepair -= dt * (hampered ? 0 : clamp(this.crewFraction + 0.3, 0.3, 1));
      if (this.steeringRepair <= 0) {
        this.steeringFailed = false;
        this.report('info', 'Steering gear repaired: the rudder answers.');
      }
    }
    this.fireControl = clamp(this.fireControl + TUNING.directorRepairPerSecond * dt, 0, this.fireControl < 0.1 ? 0.1 : 1);
  }

  /** Heel, trim and sinkage from the water aboard and where it is. */
  private stability(): void {
    const M = this.floodTotal;
    let mz = 0;
    let mx = 0;
    let freeSurface = 0;
    for (const c of this.comps) {
      if (c.flood <= 0) continue;
      const f = c.flood / c.spec.capacityT;
      mz += c.flood * c.floodSide * (1 - f);
      mx += c.flood * (c.spec.x0 + c.spec.x1) / 2;
      freeSurface += f * (1 - f);
    }
    const reserve = this.spec.reserveT;
    this.sinkageM = M / (RHO * this.waterplane);
    this.gmEff = this.spec.gm * (1 - 0.55 * clamp(M / reserve, 0, 1.2)) - 0.18 * freeSurface;
    const displacement = this.spec.displacementT + M;
    const gm = Math.max(this.gmEff, 0.15);
    const targetList = Math.atan(mz / (displacement * gm));
    this.listRad += (clamp(targetList, -0.7, 0.7) - this.listRad) * 0.05;
    const gml = 140;
    // Water forward puts the bow down: negative trim is bow down, matching the renderer's pitch (positive is bow up).
    this.trimRad += (clamp(-mx / (displacement * gml), -0.25, 0.25) - this.trimRad) * 0.05;
  }

  /** Decide what state the ship is in: crippled, struck, sinking. */
  private assess(dt: number): void {
    const reserve = this.spec.reserveT;
    const hopeless = this.floodTotal >= reserve || Math.abs(this.listRad) > 0.65 || this.gmEff <= 0.1;
    if (hopeless) {
      this.status = 'sinking';
      this.sinkTime = 0;
      this.sinkSign = this.listRad >= 0 ? 1 : -1;
      this.report('critical', 'She is going down!');
      return;
    }

    // Morale: men lost, fires, a crippled ship, a lopsided one.
    const casualties = 1 - this.crewFraction;
    const fireLoad = clamp(this.fires / 3, 0, 1);
    const lost = this.turretsAtStart > 0 ? this.turretsLost / this.turretsAtStart : 0;
    const settle = clamp(this.floodTotal / reserve, 0, 1);
    this.morale = clamp(
      1 - 0.9 * casualties - 0.3 * fireLoad - 0.25 * (1 - this.power) - 0.3 * clamp(Math.abs(this.listRad) / 0.26, 0, 1) - 0.3 * lost - 0.3 * settle,
      0,
      1,
    );
    const crippled = this.power < 0.12 || lost >= 1 || settle > 0.6;
    if (this.status === 'afloat' && crippled) {
      this.status = 'crippled';
      this.report('critical', crippled && lost >= 1 ? 'All main guns are out of action.' : 'The ship is crippled.');
    } else if (this.status === 'crippled' && !crippled) {
      this.status = 'afloat';
    }
    if (this.canStrike && this.status === 'crippled' && this.morale < 0.4 && this.strikeIn === null) this.strikeIn = 12;
    if (this.strikeIn !== null && this.status === 'crippled') {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.status = 'struck';
        this.report('critical', 'She has struck her colours!');
      }
    }
  }

  private stepSinking(dt: number): void {
    this.sinkTime += dt;
    this.sunkDepth += 0.5 * TUNING.sinkAcceleration * (2 * this.sinkTime + dt) * dt;
    // She rolls over as she goes and the bow or stern lifts.
    const target = 1.25 * this.sinkSign;
    this.listRad += (target - this.listRad) * 0.012;
    this.trimRad += (-0.18 - this.trimRad) * 0.01;
    if (this.sunkDepth > TUNING.sunkDepth) this.status = 'sunk';
  }

  // ---- views -----------------------------------------------------------------------------------

  /** A summary for the damage display. */
  summary(): {
    status: ShipStatus;
    power: number;
    crew: number;
    morale: number;
    listDeg: number;
    trimDeg: number;
    floodedT: number;
    reserveT: number;
    fires: number;
    turretsLost: number;
    turretsTotal: number;
    fireControl: number;
    steeringFailed: boolean;
    torpedoHits: number;
    counterFlooded: number;
  } {
    return {
      status: this.status,
      power: this.power,
      crew: this.crewFraction,
      morale: this.morale,
      listDeg: (this.listRad * 180) / Math.PI,
      trimDeg: (this.trimRad * 180) / Math.PI,
      floodedT: this.floodTotal,
      reserveT: this.spec.reserveT,
      fires: this.fires,
      turretsLost: this.turretsLost,
      turretsTotal: this.turretsAtStart,
      fireControl: this.fireControl,
      steeringFailed: this.steeringFailed,
      torpedoHits: this.torpedoHits,
      counterFlooded: this.counterFlooded,
    };
  }

  /** Is a plate on the ship as it floats now: used by callers to lower the target as it settles. */
  get holesCount(): number {
    return this.holes.length;
  }

  /** Ship-space positions of burning compartments and turrets, for smoke and flames. */
  fireSites(): { at: V3; intensity: number }[] {
    const out: { at: V3; intensity: number }[] = [];
    for (const c of this.comps) {
      if (c.fire > 0.05) {
        const hb = this.geometry.hull.halfBreadth((c.spec.x0 + c.spec.x1) / 2);
        const x = (c.spec.x0 + c.spec.x1) / 2;
        // Where on the deck it shows wanders with time but does not touch the simulation's random stream.
        out.push({ at: [x, this.geometry.hull.deckHeight(x) + 0.5, Math.sin(this.time * 0.7 + x) * hb * 0.3], intensity: c.fire });
      }
    }
    for (const t of this.turrets) {
      if (t.fire > 0.05) {
        const g = this.geometry.turrets.find((x) => x.id === t.id)!;
        out.push({ at: [g.axisX, g.zone.max[1] + 0.5, g.axisZ], intensity: t.fire });
      }
    }
    return out;
  }
}

