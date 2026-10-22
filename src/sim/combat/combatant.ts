import type { ShipSpec } from '../../render/ships/forge/spec';
import { buildHitGeometry, type HitGeometry, type V3 } from '../damage/geometry';
import { ShipDamage, type DamageReport } from '../damage/ship-damage';
import type { DamageSpec } from '../damage/spec';
import { traceShell, type TraceResult } from '../damage/trace';
import type { Environment } from '../gunnery/ballistics';
import type { ShipSetup } from './setup';
import { DEFAULT_DISPERSION, type DispersionSpec } from '../gunnery/dispersion';
import type { GunSpec } from '../gunnery/guns';
import type { MuzzleShot } from '../gunnery/battery';
import { Gunnery, type AerialObserver, type Contact } from '../gunnery/gunnery';
import type { SalvoReport } from '../gunnery/spotting';
import type { ShellKind } from '../gunnery/shells';
import type { HitMark } from '../../render/ships/decals';
import { mountsFromSpec } from '../gunnery/mounts';
import type { RangefinderSpec } from '../gunnery/rangefinder';
import type { DiveInfo, ImpactInfo, ImpactResolution, ShellEvent } from '../gunnery/shell-world';
import { Rng } from '../rng';
import type { TorpedoSpec, TubeSpec } from '../torpedo/spec';
import { TubeBattery, type TubeFiring } from '../torpedo/tubes';
import type { Torpedo, TorpedoTarget, TorpedoWorld } from '../torpedo/world';
import type { ShipDynamics } from '../ships/dynamics';
import type { ShipFrame } from '../ships/frame';
import { SMOKE, type SmokeField } from '../smoke/smoke-field';
import type { Terrain } from '../terrain/terrain';

export interface BatterySetup {
  id: string;
  gun: GunSpec;
  /** The turrets (by id in the ship spec) that make up this battery. */
  turretIds: readonly string[];
}

/** How well drilled a gun crew is: 1 is the reference, more is worse. Scales rangefinder error and shot dispersion. */
export interface Skill {
  rangefinderError: number;
  dispersion: number;
}

export interface CombatantConfig {
  id: number;
  name: string;
  ship: ShipSpec;
  damage: DamageSpec;
  dynamics: ShipDynamics;
  /** The ship's present pose. The rendered game supplies the wave-following one; the headless duel a flat one. */
  frame: () => ShipFrame;
  batteries: readonly BatterySetup[];
  rangefinder: RangefinderSpec;
  skill?: Skill;
  env: () => Environment;
  visibilityKm: () => number;
  seed: number;
  directorHeight?: number;
  /** The torpedoes in the water, shared by every ship in the fight (needed to launch any). */
  torpedoes?: TorpedoWorld;
  tubes?: readonly TubeSpec[];
  torpedo?: TorpedoSpec;
  small?: boolean;
  /** She is painted in dazzle, 0..1: the other side's readings of her are coarser at a distance. */
  dazzle?: number;
  /** A battery that picks its own targets from the small craft among the opponents. */
  autoTarget?: { battery: string; maxRange: number; capitalRange?: number };
  /** Seconds between firing solutions for this ship's batteries. */
  solvePeriod?: number;
  /** The land: shells strike it and it can stand between the ships. */
  terrain?: Terrain;
  /** The smoke on the water, shared by every ship in the fight: it blocks the view between ships and takes the smoke she lays. */
  smoke?: SmokeField;
  /** Turrets whose mechanism jams when they fire (see ShipSetup). */
  jams?: ShipSetup['jams'];
  /** Damage she begins the fight with, and the rudder angle her jammed steering holds. */
  wounds?: ShipSetup['wounds'];
  rudderJam?: number;
  /** She never strikes her colours. */
  neverStrikes?: boolean;
  /** How fast her plotting table works (default: the real one). */
  plot?: ShipSetup['plot'];
}

export interface BatteryUnit {
  setup: BatterySetup;
  gunnery: Gunnery;
}

export interface ShipReport extends DamageReport {
  ship: string;
  /** World position, when the report has one. */
  world?: V3;
}

const filler = (massKg: number, fillerKg?: number): number => fillerKg ?? massKg * 0.05;

/**
 * One ship in a fight: her motion, her guns, her armour and what has happened to her. She is a `Contact` for the other
 * side's gunnery, resolves the hits on her through her own plates, and feeds her damage back into her speed, her rudder,
 * her turrets and her fire control.
 */
export class Combatant implements Contact {
  readonly id: number;
  readonly name: string;
  readonly damage: ShipDamage;
  readonly geometry: HitGeometry;
  readonly batteries: BatteryUnit[] = [];
  /** Torpedo tubes, if she has any, and how a salvo is set. */
  readonly tubes: TubeBattery | null;
  torpedoSetting = 0;
  torpedoSpread = 12;
  torpedoDepth = 4;
  torpedoesLaunched = 0;
  torpedoHitsTaken = 0;
  onTorpedoLaunch?: (t: Torpedo) => void;
  /** The ship as a torpedo target (her underwater outline, and what a hit does). */
  readonly torpedoTarget: TorpedoTarget;
  private queuedLaunches: { firing: TubeFiring; at: number }[] = [];
  private autoTimer = 0;
  private opponents: Contact[] = [];
  private readonly autoBatteries: Set<BatteryUnit> = new Set();
  readonly dynamics: ShipDynamics;
  hitsTaken = 0;
  /** Every shell that reached her hit box, by what her armour made of it (and how many dived under the water). */
  readonly impacts = { burst: 0, shatter: 0, ricochet: 0, pass: 0, dive: 0 };
  /** The same, by the first plate struck: 'belt:shatter', 'turret-face:burst'... (a diagnostic for tuning). */
  readonly byPlate: Record<string, number> = {};
  shellsFired = 0;
  /** Laying a smoke screen astern. */
  makingSmoke = false;
  private puffTimer = 0;
  /** Shells that struck an opponent, and salvos begun, for the debrief. */
  hitsScored = 0;
  onShot?: (shot: MuzzleShot, unit: BatteryUnit) => void;
  onShellEvent?: (event: ShellEvent, unit: BatteryUnit) => void;
  onReport?: (report: SalvoReport, unit: BatteryUnit) => void;
  /** A shell struck her hull or works: where, and what became of it, for the marks it leaves on her. */
  onHitMark?: (mark: HitMark) => void;

  private readonly frameOf: () => ShipFrame;
  private readonly rng: Rng;
  private readonly jamRng: Rng;
  private pending: ShipReport[] = [];
  private struckHandled = false;
  private readonly turretIndex = new Map<string, { unit: BatteryUnit; index: number }>();
  private readonly top: number;

  constructor(readonly cfg: CombatantConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.dynamics = cfg.dynamics;
    this.frameOf = cfg.frame;
    this.rng = new Rng(cfg.seed);
    this.geometry = buildHitGeometry(cfg.ship, cfg.damage);
    this.damage = new ShipDamage(
      cfg.damage,
      this.geometry,
      new Rng(cfg.seed ^ 0x9e3779b9),
      cfg.ship.turrets.map((t) => t.id),
      { length: cfg.ship.hull.length, beam: cfg.ship.hull.beam, draft: cfg.ship.hull.draft },
      cfg.ship.funnels.length,
      minorTurrets(cfg.ship),
    );
    if (cfg.wounds) this.damage.wound(cfg.wounds);
    if (cfg.rudderJam !== undefined && cfg.wounds?.steering) this.dynamics.rudderJam = cfg.rudderJam;
    if (cfg.neverStrikes) this.damage.canStrike = false;
    this.jamRng = new Rng(cfg.seed ^ 0x4a414d);

    const skill = cfg.skill ?? { rangefinderError: 1, dispersion: 1 };
    const all = mountsFromSpec(cfg.ship);
    cfg.batteries.forEach((setup, bi) => {
      const mounts = setup.turretIds.map((id) => all.find((m) => m.id === id)!);
      const d = DEFAULT_DISPERSION;
      const dispersion: DispersionSpec = {
        velocity: d.velocity * skill.dispersion,
        elevation: d.elevation * skill.dispersion,
        azimuth: d.azimuth * skill.dispersion,
        salvoVelocity: d.salvoVelocity * skill.dispersion,
        salvoElevation: d.salvoElevation * skill.dispersion,
        salvoAzimuth: d.salvoAzimuth * skill.dispersion,
      };
      const gunnery = new Gunnery({
        gun: setup.gun,
        mounts,
        rng: new Rng(cfg.seed + 101 * (bi + 1)),
        shooterId: cfg.id,
        env: cfg.env(),
        rangefinder: {
          ...cfg.rangefinder,
          angularError: cfg.rangefinder.angularError * skill.rangefinderError,
          biasFraction: cfg.rangefinder.biasFraction * skill.rangefinderError,
        },
        dispersion,
        visibilityKm: cfg.visibilityKm(),
        directorHeight: cfg.directorHeight ?? 24,
        solvePeriod: cfg.solvePeriod,
        plot: cfg.plot,
      });
      if (cfg.terrain) gunnery.terrain = cfg.terrain;
      const smoke = cfg.smoke;
      if (smoke) gunnery.occlusion = (ax, az, bx, bz) => smoke.transmission(ax, az, bx, bz);
      const unit: BatteryUnit = { setup, gunnery };
      gunnery.onShot = (shot) => {
        this.shellsFired++;
        // A quadruple mounting's mechanism may jam as it fires: the first barrel of a turret's salvo is the roll.
        const jams = cfg.jams;
        if (jams && shot.gun === 0) {
          const id = setup.turretIds[shot.turret];
          if (id !== undefined && jams.turretIds.includes(id) && this.jamRng.next() < jams.chance) this.damage.jamTurret(id, jams.seconds, 'has jammed in the loading cycle');
        }
        this.onShot?.(shot, unit);
      };
      gunnery.onShellEvent = (e) => {
        if (e.kind === 'hit' && (e.outcome === null || e.outcome.kind === 'burst')) this.hitsScored++;
        this.onShellEvent?.(e, unit);
      };
      gunnery.onReport = (r) => this.onReport?.(r, unit);
      this.batteries.push(unit);
      if (cfg.autoTarget?.battery === setup.id) this.autoBatteries.add(unit);
      setup.turretIds.forEach((id, index) => this.turretIndex.set(id, { unit, index }));
    });

    this.tubes = cfg.tubes ? new TubeBattery(cfg.tubes) : null;
    const self = this;
    this.torpedoTarget = {
      get id() {
        return self.id;
      },
      get alive() {
        return self.damage.floating;
      },
      get x() {
        return self.dynamics.x;
      },
      get z() {
        return self.dynamics.z;
      },
      get heading() {
        return self.dynamics.heading;
      },
      halfLength: cfg.ship.hull.length / 2,
      halfBreadthAt: (x) => this.geometry.hull.halfBreadth(x),
      keelAt: (x) => this.geometry.hull.keel(x),
      onTorpedoHit: (h) => {
        this.damage.applyTorpedo(h);
        this.torpedoHitsTaken++;
        this.collect();
      },
    };

    // Highest point above the sea, for horizon calculations.
    const masts = cfg.ship.masts.map((m) => cfg.ship.hull.deckMid + m.height + m.topmast);
    const funnels = cfg.ship.funnels.map((f) => cfg.ship.hull.deckMid + f.height);
    this.top = Math.max(20, ...masts, ...funnels);
  }

  // ---- Contact: how the other side sees her ------------------------------------------------------

  get x(): number {
    return this.dynamics.x;
  }
  get z(): number {
    return this.dynamics.z;
  }
  get vx(): number {
    return Math.sin(this.dynamics.heading) * this.dynamics.speed;
  }
  get vz(): number {
    return -Math.cos(this.dynamics.heading) * this.dynamics.speed;
  }
  get heading(): number {
    return this.dynamics.heading;
  }
  get halfLength(): number {
    return this.cfg.ship.hull.length / 2;
  }
  get halfBeam(): number {
    return this.cfg.ship.hull.beam / 2;
  }
  get draft(): number {
    return this.cfg.ship.hull.draft + 4;
  }
  get height(): number {
    return 40;
  }
  get topHeight(): number {
    return this.top - this.damage.sinkage;
  }
  get deckHeight(): number {
    return this.cfg.ship.hull.deckMid - this.damage.sinkage;
  }
  get small(): boolean {
    return this.cfg.small ?? false;
  }
  get dazzle(): number {
    return this.cfg.dazzle ?? 0;
  }
  get struck(): boolean {
    return this.damage.status === 'struck';
  }
  /** Still worth shooting at: afloat, struck or sinking, but not a wreck on its way down. */
  get alive(): boolean {
    return this.damage.status !== 'sunk' && this.damage.status !== 'exploded';
  }

  // ---- being hit ---------------------------------------------------------------------------------

  private toLocal(wx: number, wy: number, wz: number): V3 {
    const d = this.dynamics;
    const sh = Math.sin(d.heading);
    const ch = Math.cos(d.heading);
    const dx = wx - d.x;
    const dz = wz - d.z;
    const x = dx * sh - dz * ch;
    const z0 = dx * ch + dz * sh;
    const y0 = wy + this.damage.sinkage;
    const phi = this.damage.list;
    return [x, y0 * Math.cos(phi) + z0 * Math.sin(phi), z0 * Math.cos(phi) - y0 * Math.sin(phi)];
  }

  private dirToLocal(vx: number, vy: number, vz: number): V3 {
    const sh = Math.sin(this.dynamics.heading);
    const ch = Math.cos(this.dynamics.heading);
    const x = vx * sh - vz * ch;
    const z0 = vx * ch + vz * sh;
    const phi = this.damage.list;
    return [x, vy * Math.cos(phi) + z0 * Math.sin(phi), z0 * Math.cos(phi) - vy * Math.sin(phi)];
  }

  private toWorld(p: V3): V3 {
    const d = this.dynamics;
    const phi = this.damage.list;
    const y = p[1] * Math.cos(phi) - p[2] * Math.sin(phi);
    const z = p[2] * Math.cos(phi) + p[1] * Math.sin(phi);
    const sh = Math.sin(d.heading);
    const ch = Math.cos(d.heading);
    return [d.x + p[0] * sh + z * ch, y - this.damage.sinkage, d.z - p[0] * ch + z * sh];
  }

  private trainOf = (id: string): number => {
    const t = this.turretIndex.get(id);
    return t ? t.unit.gunnery.battery.turrets[t.index]!.train : 0;
  };

  resolveHit = (info: ImpactInfo): ImpactResolution | null => {
    if (!this.alive) return null;
    const spec = info.shell.spec;
    const speed = Math.hypot(...info.velocity);
    const from = this.toLocal(...info.from);
    const to = this.toLocal(...info.to);
    const dir = this.dirToLocal(info.velocity[0] / speed, info.velocity[1] / speed, info.velocity[2] / speed);
    const segment = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const trace = traceShell(
      this.geometry,
      this.trainOf,
      { massKg: spec.massKg, diameterMm: spec.diameterM * 1000, speed, impact: spec.fuze === 'impact', armour: spec.armour },
      { origin: from, dir, segment },
    );
    if (!trace) return null;
    return this.apply(trace, spec.massKg, spec.diameterM * 1000, filler(spec.massKg, spec.fillerKg), spec.kind === 'he', dir);
  };

  /** A shell that fell close by and may have kept going under the water into the hull. */
  resolveDive = (info: DiveInfo): ImpactResolution | null => {
    if (!this.alive || info.angleDeg < 6 || this.rng.next() > 0.55) return null;
    const spec = info.shell.spec;
    const caliber = spec.diameterM / 0.305;
    const origin = this.toLocal(info.x, 0, info.z);
    const dir = this.dirToLocal(info.velocity[0] / info.speed, info.velocity[1] / info.speed, info.velocity[2] / info.speed);
    const reach = 45 * caliber * Math.min(1, info.angleDeg / 15);
    const shell = { massKg: spec.massKg, diameterMm: spec.diameterM * 1000, speed: info.speed * 0.6, impact: spec.fuze === 'impact', armour: spec.armour };
    const probe = traceShell(this.geometry, this.trainOf, shell, { origin, dir, segment: reach });
    if (!probe || probe.entry[1] > -0.3) return null;
    // Water slows it quickly: the speed it has when it reaches the hull.
    const travelled = Math.hypot(probe.entry[0] - origin[0], probe.entry[1] - origin[1], probe.entry[2] - origin[2]);
    const speed = info.speed * 0.6 * Math.exp(-travelled / (50 * caliber));
    const trace = traceShell(this.geometry, this.trainOf, { ...shell, speed }, { origin, dir, segment: reach });
    if (!trace || trace.entry[1] > -0.3 || trace.kind === 'pass') return null;
    return this.apply(trace, spec.massKg, spec.diameterM * 1000, filler(spec.massKg, spec.fillerKg), spec.kind === 'he');
  };

  /** Load a kind of round in the main battery: the self-directing anti-destroyer guns keep their own. */
  setShell(kind: ShellKind): void {
    for (const b of this.batteries) if (!this.autoBatteries.has(b)) b.gunnery.setShell(kind);
  }

  private apply(trace: TraceResult, massKg: number, diameterMm: number, fillerKg: number, highExplosive = false, dir?: V3): ImpactResolution {
    this.damage.applyTrace(trace, { massKg, diameterMm, fillerKg, highExplosive });
    if (this.onHitMark && dir) {
      // The surface faces the way the shell came from, along the axis of the plate it struck.
      const axis = trace.first.axis;
      const normal: [number, number, number] = [0, 0, 0];
      normal[axis] = dir[axis] > 0 ? -1 : 1;
      this.onHitMark({ at: trace.entry, normal, caliberM: diameterMm / 1000, kind: trace.kind, plate: trace.first.kind });
    }
    this.impacts[trace.kind]++;
    const key = `${trace.first.kind}:${trace.kind}`;
    this.byPlate[key] = (this.byPlate[key] ?? 0) + 1;
    if (trace.kind === 'burst') this.hitsTaken++;
    this.collect();
    return { kind: trace.kind, at: this.toWorld(trace.at), consumed: trace.kind !== 'pass', speed: trace.speed };
  }

  private collect(): void {
    for (const r of this.damage.drainReports()) {
      this.pending.push({ ...r, ship: this.name, world: r.at ? this.toWorld(r.at) : undefined });
    }
  }

  /** Reports since the last call, for the message log. */
  drainReports(): ShipReport[] {
    const r = this.pending;
    this.pending = [];
    return r;
  }

  // ---- torpedoes ---------------------------------------------------------------------------------

  /** Torpedoes in the tubes and spare, for the player's reckoning. */
  get torpedoesLeft(): number {
    return this.tubes?.remaining ?? 0;
  }

  /** Order the tubes onto a launch bearing, relative to the bow (radians). */
  orderTubes(relativeBearing: number): void {
    this.tubes?.order(relativeBearing);
  }

  /** Fire a fan from every tube that is loaded and on its bearing. Returns how many torpedoes go. */
  fireTorpedoes(now: number): number {
    if (!this.tubes || !this.cfg.torpedoes || !this.damage.floating || this.damage.status === 'struck') return 0;
    const firings = this.tubes.fire(this.torpedoSpread);
    for (const firing of firings) this.queuedLaunches.push({ firing, at: now + firing.delay });
    return firings.length;
  }

  private launchDue(now: number): void {
    if (this.queuedLaunches.length === 0 || !this.tubes || !this.cfg.torpedoes) return;
    const due = this.queuedLaunches.filter((q) => q.at <= now);
    if (due.length === 0) return;
    this.queuedLaunches = this.queuedLaunches.filter((q) => q.at > now);
    const frame = this.frameOf();
    const spec = this.cfg.torpedo!;
    for (const q of due) {
      const tube = this.tubes.tubes[q.firing.tube]!.spec;
      const sh = Math.sin(frame.heading);
      const ch = Math.cos(frame.heading);
      const t = this.cfg.torpedoes.launch({
        shooter: this.id,
        spec,
        x: frame.x + tube.x * sh + tube.z * ch,
        z: frame.z - tube.x * ch + tube.z * sh,
        heading: frame.heading + q.firing.bearing,
        settingIndex: this.torpedoSetting,
        depth: this.torpedoDepth,
      });
      this.torpedoesLaunched++;
      this.onTorpedoLaunch?.(t);
    }
  }

  // ---- anti-destroyer guns pick their own targets -------------------------------------------------

  /** While she is making smoke, a puff leaves her stern every second or so, to be carried off by the wind. */
  private layDownSmoke(dt: number): void {
    const smoke = this.cfg.smoke;
    if (!smoke || !this.makingSmoke || !this.damage.floating) return;
    this.puffTimer -= dt;
    if (this.puffTimer > 0) return;
    this.puffTimer = SMOKE.puffEvery;
    const d = this.dynamics;
    const aft = this.cfg.ship.hull.length * 0.45;
    smoke.emit(d.x - Math.sin(d.heading) * aft, d.z + Math.cos(d.heading) * aft, this.vx, this.vz);
  }

  /**
   * Every second or so, point the self-directing batteries at the nearest small craft within reach; a battery with guns big
   * enough to hurt a capital ship (the 6-inch of a Queen Elizabeth) takes the nearest of those when no small craft is near.
   */
  private chooseAutoTargets(dt: number, opponents: readonly Contact[]): void {
    this.autoTimer += dt;
    if (this.autoTimer < 1) return;
    this.autoTimer = 0;
    const range = this.cfg.autoTarget?.maxRange ?? 0;
    const capital = this.cfg.autoTarget?.capitalRange ?? 0;
    for (const unit of this.autoBatteries) {
      let best: Contact | null = null;
      let bestD = range;
      for (const c of opponents) {
        if (!c.small || c.alive === false || c.struck) continue;
        const d = Math.hypot(c.x - this.x, c.z - this.z);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
      if (!best && capital > 0) {
        bestD = capital;
        for (const c of opponents) {
          if (c.small || c.alive === false || c.struck) continue;
          const d = Math.hypot(c.x - this.x, c.z - this.z);
          if (d < bestD) {
            best = c;
            bestD = d;
          }
        }
      }
      const g = unit.gunnery;
      if (best !== g.target) g.designate(best);
      g.autoSpot = true;
    }
  }

  // ---- fighting ----------------------------------------------------------------------------------

  /** The ship's gunnery officers: one per battery, main battery first. */
  get main(): Gunnery {
    return this.batteries[0]!.gunnery;
  }

  /** An aircraft that sees for every battery what the ship cannot. */
  setAerial(observer: AerialObserver | null): void {
    for (const b of this.batteries) b.gunnery.aerial = observer;
  }

  /** Set the opposing ships every battery may fire at. */
  setOpponents(contacts: readonly Contact[]): void {
    this.opponents = [...contacts];
    for (const b of this.batteries) {
      b.gunnery.contacts.length = 0;
      b.gunnery.contacts.push(...contacts);
    }
  }

  /**
   * Advance by `dt`. `triggers[i]` is whether battery i's trigger is held. Damage works on the ship, the ship's condition
   * works on her guns, and each battery's gunnery steps. Returns the shell events of every battery.
   */
  step(dt: number, now: number, triggers: readonly boolean[]): ShellEvent[] {
    const dmg = this.damage;
    dmg.update(dt);
    this.collect();

    const d = this.dynamics;
    d.powerFactor = dmg.speedFactor;
    if (dmg.steeringFailed) {
      if (d.rudderJam === null) d.rudderJam = d.rudder;
    } else d.rudderJam = null;
    if (dmg.status === 'struck' && !this.struckHandled) {
      this.struckHandled = true;
      d.setTelegraph(0);
    }

    this.layDownSmoke(dt);

    if (this.tubes) {
      for (const t of this.tubes.tubes) {
        // A tube mounting that is also a turret in the damage model goes out of action with it.
        const known = dmg.turrets.some((x) => x.id === t.spec.id);
        t.enabled = known ? dmg.turretAvailable(t.spec.id) : dmg.floating;
      }
      this.tubes.update(dt);
      this.launchDue(now);
    }
    this.chooseAutoTargets(dt, this.opponents);

    const frame = this.frameOf();
    const out: ShellEvent[] = [];
    const canFire = dmg.floating && dmg.status !== 'struck';
    this.batteries.forEach((b, i) => {
      const g = b.gunnery;
      g.fireControlHealth = dmg.fireControl;
      g.visibilityKm = this.cfg.visibilityKm();
      g.world.env = this.cfg.env();
      b.setup.turretIds.forEach((id, index) => {
        g.battery.setAvailability(index, dmg.turretAvailable(id), dmg.turretReloadFactor(id));
      });
      // A self-directing battery fires on its own as soon as it has a target and a usable plot.
      const trigger = this.autoBatteries.has(b) ? g.target !== null && g.canReach && g.track.count >= 4 : (triggers[i] ?? false);
      const events = g.update(dt, now, frame, canFire && trigger);
      out.push(...events);
    });
    return out;
  }
}

/** The parts of a ship setup that the combatant's config carries as separate fields. */
export function setupExtras(setup: ShipSetup): Pick<CombatantConfig, 'tubes' | 'torpedo' | 'small' | 'dazzle' | 'autoTarget' | 'jams' | 'wounds' | 'rudderJam' | 'neverStrikes' | 'plot'> {
  return {
    tubes: setup.tubes,
    torpedo: setup.torpedo,
    small: setup.small,
    dazzle: setup.dazzle,
    autoTarget: setup.autoTarget,
    jams: setup.jams,
    wounds: setup.wounds,
    rudderJam: setup.rudderJam,
    neverStrikes: setup.neverStrikes,
    plot: setup.plot,
  };
}

/**
 * The turrets too small to count in the reckoning of how many main guns a ship has left: those with less than half the bore of
 * her biggest (the 12-pounders of a Dreadnought, the 6-inch of a Queen Elizabeth), so that she is not crippled or demoralised
 * by the loss of her secondary battery alone, nor kept in the fight by it.
 */
export function minorTurrets(ship: ShipSpec): string[] {
  const biggest = ship.turrets.reduce((m, t) => Math.max(m, t.boreMm), 0);
  return ship.turrets.filter((t) => t.boreMm < biggest * 0.5).map((t) => t.id);
}
