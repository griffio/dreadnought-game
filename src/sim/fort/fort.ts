import { Rng } from '../rng';
import { throughPlate } from '../damage/penetration';
import { DEFAULT_DISPERSION, type DispersionSpec } from '../gunnery/dispersion';
import { Gunnery, type Contact } from '../gunnery/gunnery';
import type { Environment } from '../gunnery/ballistics';
import type { TurretMount } from '../gunnery/battery';
import type { GunSpec } from '../gunnery/guns';
import type { RangefinderSpec } from '../gunnery/rangefinder';
import type { ImpactInfo, ImpactResolution, ShellEvent } from '../gunnery/shell-world';
import { shipFrameAt, type ShipFrame } from '../ships/frame';
import type { Terrain } from '../terrain/terrain';

const DEG = Math.PI / 180;

/** One gun position of a fort: a pit, a casemate in the hillside, a howitzer in its emplacement. */
export interface EmplacementSpec {
  id: string;
  /** Where it stands relative to the fort's centre, metres: east and south. */
  dx: number;
  dz: number;
  /** Armour in front, mm of steel (a casemate's shield and the concrete behind it); 0 for an open pit. */
  frontMm: number;
  /** Armour overhead, mm of steel (a pit has none; a casemate has a few metres of earth and concrete). */
  roofMm: number;
  /** Half the size of the position, metres: a shell that falls within it has struck the gun. */
  radius: number;
  /** Height of the structure above the ground, metres. */
  height: number;
  /** Where the guns may be trained: the middle of the arc and its half-width, compass degrees. Open pits turn all the way round. */
  arc?: { centreDeg: number; halfDeg: number };
}

export interface FortSpec {
  id: string;
  name: string;
  /** World position of the middle of the works, metres. */
  x: number;
  z: number;
  gun: GunSpec;
  emplacements: readonly EmplacementSpec[];
  rangefinder: RangefinderSpec;
  /** Skill of the gun crews: multiples of the ordinary range-finding error and scatter (more is worse). */
  skill?: { rangefinderError: number; dispersion: number };
  /** Height of the lookout's eye above the ground at the guns, metres. */
  eye: number;
  /** An observation post away from the guns: the strait is seen from it, not from the gun pits behind the hill. */
  observer?: { x: number; z: number; eye: number };
  /** The works cannot be seen by the lookouts of a ship until she is revealed by her own guns, or by an aeroplane. */
  hidden?: boolean;
  /** Rounds per gun. */
  ammunition?: number;
}

export type EmplacementState = 'ready' | 'wrecked';

export interface Emplacement {
  spec: EmplacementSpec;
  state: EmplacementState;
  /** Fraction of the crew still on their feet. */
  crew: number;
  rounds: number;
  worldX: number;
  worldZ: number;
}

/** Tuning for how a fort suffers. */
export const FORT_TUNING = {
  /** How fast suppression wears off with no shell falling near, per second. */
  suppressionRecovery: 0.012,
  /** Suppression above which the crews keep their heads down and fire nothing. */
  coverThreshold: 0.8,
  /** Crew fraction below which a position is out of action. */
  crewMinimum: 0.2,
  /** Seconds the flash of a gun gives the works away. */
  revealSeconds: 120,
  /** The most a fort's ranging can be spoiled by suppression. */
  fireControlLoss: 0.6,
  /** Blast radius per square root of kg of filler, metres. */
  blastPerRootKg: 7,
  /** How far from a gun a fall still shakes its crew, metres, as a multiple of the position's radius. */
  nearMissReach: 4,
  /** Crew lost to a shell that falls among the guns, at the most (the fraction of a crew). */
  nearMissCasualties: 0.05,
};

let nextFortId = 100;

export interface FortConfig {
  spec: FortSpec;
  /** The gun mounts, from the model the fort is drawn from, so that the shells leave where the barrels are. */
  mounts: readonly TurretMount[];
  terrain: Terrain;
  env: () => Environment;
  visibilityKm: () => number;
  seed: number;
  id?: number;
}

/**
 * A battery on the shore. She cannot move, but she stands on the high ground and sees a long way from it; her guns are
 * trained and laid by the same fire-control chain as a ship's (range-finding, a plot, a ballistic solution, spotting of the
 * fall), and she is a target like a ship: each emplacement has its armour and is destroyed by a shell that gets through it.
 * Shells that fall close shake the crews (suppression: they fire slowly and badly, and not at all while they are under cover),
 * and when every position is out of action she is silenced.
 */
export class Fort implements Contact {
  readonly id: number;
  readonly spec: FortSpec;
  readonly name: string;
  readonly emplacements: Emplacement[];
  readonly gunnery: Gunnery;
  readonly frame: ShipFrame;
  /** Ground level at the works, metres above the sea. */
  readonly base: number;
  readonly x: number;
  readonly z: number;
  readonly vx = 0;
  readonly vz = 0;
  readonly heading = 0;
  readonly halfLength: number;
  readonly halfBeam: number;
  /** 0..1: how badly she is being kept under cover. */
  suppression = 0;
  /** Her flash was seen: she is known to the ships until this time. */
  revealedUntil = Number.NEGATIVE_INFINITY;
  shellsFired = 0;
  hitsTaken = 0;
  onShot?: (shot: { muzzle: [number, number, number]; direction: [number, number, number] }, fort: Fort) => void;
  onShellEvent?: (e: ShellEvent) => void;
  onReport?: (text: string) => void;

  private readonly foes: Contact[] = [];
  private readonly rng: Rng;
  private readonly structureHeight: number;
  /** How far her guns reach, metres: worked out once, since it is a full ballistic flight to find. */
  private readonly reach: number;
  private silencedReported = false;

  constructor(private readonly cfg: FortConfig) {
    this.spec = cfg.spec;
    this.id = cfg.id ?? nextFortId++;
    this.name = cfg.spec.name;
    this.x = cfg.spec.x;
    this.z = cfg.spec.z;
    this.base = Math.max(cfg.terrain.heightAt(this.x, this.z), 0);
    this.rng = new Rng(cfg.seed);
    this.frame = shipFrameAt(this.x, this.z, 0);
    this.frame.y = this.base;
    const rounds = cfg.spec.ammunition ?? 90;
    this.emplacements = cfg.spec.emplacements.map((spec) => ({
      spec,
      state: 'ready',
      crew: 1,
      rounds,
      worldX: this.x + spec.dx,
      worldZ: this.z + spec.dz,
    }));
    let reach = 0;
    let top = 0;
    for (const e of this.emplacements) {
      reach = Math.max(reach, Math.hypot(e.spec.dx, e.spec.dz) + e.spec.radius);
      top = Math.max(top, e.spec.height);
    }
    this.halfLength = Math.max(reach, 8);
    this.halfBeam = this.halfLength;
    this.structureHeight = Math.max(top, 3);

    const skill = cfg.spec.skill ?? { rangefinderError: 1, dispersion: 1 };
    this.gunnery = new Gunnery({
      gun: cfg.spec.gun,
      mounts: cfg.mounts,
      rng: new Rng(cfg.seed ^ 0x5bd1e995),
      shooterId: this.id,
      env: cfg.env(),
      rangefinder: {
        ...cfg.spec.rangefinder,
        angularError: cfg.spec.rangefinder.angularError * skill.rangefinderError,
        biasFraction: cfg.spec.rangefinder.biasFraction * skill.rangefinderError,
      },
      dispersion: scaledDispersion(skill.dispersion),
      visibilityKm: cfg.visibilityKm(),
      directorHeight: cfg.spec.eye,
      // A battery's ship is far off and slow: a solution a second is plenty, and the batteries' are staggered so that they do not all fall due in one step.
      solvePeriod: 0.85 + 0.12 * (this.id % 5),
    });
    this.gunnery.terrain = cfg.terrain;
    this.reach = this.gunnery.cfgMaxRange();
    if (cfg.spec.observer) {
      const o = cfg.spec.observer;
      this.gunnery.observer = { x: o.x, z: o.z, y: Math.max(cfg.terrain.heightAt(o.x, o.z), 0) + o.eye };
    }
    this.gunnery.onShot = (shot) => {
      this.shellsFired++;
      const gun = this.emplacements[shot.turret];
      if (gun && gun.rounds > 0) gun.rounds--;
      this.revealedUntil = this.now + FORT_TUNING.revealSeconds;
      this.onShot?.(shot, this);
    };
    this.gunnery.onShellEvent = (e) => this.onShellEvent?.(e);
  }

  private now = 0;

  // ---- Contact: how the ships see her ------------------------------------------------------------

  get draft(): number {
    // The box stands on the ground: its floor is the ground level, so the "draft" below the sea is negative.
    return -this.base;
  }
  get height(): number {
    return this.base + this.structureHeight;
  }
  get topHeight(): number {
    return this.base + this.structureHeight + 4;
  }
  get deckHeight(): number {
    return this.base + 1;
  }
  get baseHeight(): number {
    return this.base;
  }
  /** The first position that still fires: where the guns of the ships are laid. When all are out, the middle of the works. */
  private get aimEmplacement(): Emplacement | null {
    return this.emplacements.find((e) => this.operable(e)) ?? null;
  }
  get aimX(): number {
    return this.aimEmplacement?.worldX ?? this.x;
  }
  get aimZ(): number {
    return this.aimEmplacement?.worldZ ?? this.z;
  }
  /** Counts the times the aim point has moved to another position, so the plot of her can begin again. */
  get aimEpoch(): number {
    const i = this.aimEmplacement ? this.emplacements.indexOf(this.aimEmplacement) : -1;
    if (i !== this.lastAim) {
      this.lastAim = i;
      this.epoch++;
    }
    return this.epoch;
  }
  private lastAim = -2;
  private epoch = 0;

  /** Still a target while she has a gun that could fire. */
  get alive(): boolean {
    return true;
  }
  get small(): boolean {
    return false;
  }
  /** A silenced fort is as good as surrendered: no more shells are to be wasted on her. */
  get struck(): boolean {
    return this.silenced;
  }

  /** Every position is out of action, or what is left of the crews will not serve. */
  get silenced(): boolean {
    return this.emplacements.every((e) => !this.operable(e));
  }

  /** Guns that could still fire. */
  get gunsLeft(): number {
    return this.emplacements.filter((e) => this.operable(e)).length;
  }

  private operable(e: Emplacement): boolean {
    return e.state === 'ready' && e.crew >= FORT_TUNING.crewMinimum && e.rounds > 0;
  }

  /** Known to the ships' lookouts: not hidden, or her flash has been seen lately. */
  revealed(now: number): boolean {
    return !this.spec.hidden || now < this.revealedUntil;
  }

  setOpponents(contacts: readonly Contact[]): void {
    this.foes.length = 0;
    this.foes.push(...contacts);
    this.gunnery.contacts.length = 0;
    this.gunnery.contacts.push(...contacts);
  }

  // ---- being hit ---------------------------------------------------------------------------------

  /** Which position, if any, a shell's path passes through, and where. */
  private strikes(info: ImpactInfo): { e: Emplacement; at: [number, number, number] } | null {
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = info.from[0] + (info.to[0] - info.from[0]) * t;
      const y = info.from[1] + (info.to[1] - info.from[1]) * t;
      const z = info.from[2] + (info.to[2] - info.from[2]) * t;
      for (const e of this.emplacements) {
        if (Math.hypot(x - e.worldX, z - e.worldZ) <= e.spec.radius && y >= this.base - 0.5 && y <= this.base + e.spec.height) {
          return { e, at: [x, y, z] };
        }
      }
    }
    return null;
  }

  resolveHit = (info: ImpactInfo): ImpactResolution | null => {
    const hit = this.strikes(info);
    if (!hit) return null;
    const { e, at } = hit;
    // A position that is already wrecked is rubble: the shell goes on into the ground behind it, and bursts there.
    if (e.state === 'wrecked') return null;
    const spec = info.shell.spec;
    const speed = Math.hypot(...info.velocity);
    this.hitsTaken++;
    // Falling steeply it meets the roof; on a flat path, the front.
    const dive = Math.abs(info.velocity[1]) / Math.max(speed, 1);
    const roof = dive > 0.55;
    const plate = roof ? e.spec.roofMm : e.spec.frontMm;
    const cos = roof ? Math.max(dive, 0.3) : Math.max(Math.sqrt(1 - dive * dive) * 0.92, 0.3);
    const filler = spec.fillerKg ?? spec.massKg * 0.05;
    const result = plate > 0 ? throughPlate(speed, spec.massKg, spec.diameterM * 1000, plate, cos) : { outcome: 'penetrate' as const, speed };
    // An impact-fuzed shell bursts on the structure it strikes; an armour-piercing one only if it gets inside.
    const bursts = result.outcome === 'penetrate' || spec.fuze === 'impact';
    if (bursts && result.outcome === 'penetrate') {
      this.burstIn(e, filler, true);
    } else if (spec.fuze === 'impact') {
      // Burst on the outside: crews shaken, a gun in the open may be hit.
      this.burstIn(e, filler, plate === 0);
    } else {
      this.shake(e, 0.12 + filler / 60, 0.02);
    }
    return { kind: result.outcome === 'penetrate' ? 'burst' : result.outcome, at, consumed: true, speed: 0 };
  };

  /** A shell bursts in or on a position: the gun and its crew take what its filler gives. */
  private burstIn(e: Emplacement, fillerKg: number, exposed: boolean): void {
    const lethality = Math.min(0.2 + fillerKg / 14, 1) * (exposed ? 1 : 0.75);
    if (this.rng.next() < lethality) {
      if (e.state !== 'wrecked') this.onReport?.(`${this.name}: a gun is wrecked at ${this.positionName(e)}.`);
      e.state = 'wrecked';
    }
    e.crew = Math.max(e.crew - (0.25 + fillerKg / 25), 0);
    this.suppression = Math.min(this.suppression + 0.2 + fillerKg / 30, 1);
    this.checkSilenced();
  }

  private shake(e: Emplacement, suppression: number, crewLoss: number): void {
    e.crew = Math.max(e.crew - crewLoss, 0);
    this.suppression = Math.min(this.suppression + suppression, 1);
  }

  private positionName(e: Emplacement): string {
    return e.spec.id;
  }

  /** A shell fell near: the shock and fragments reach the crews within the blast. */
  receive(e: ShellEvent): void {
    if (e.kind === 'hit') return;
    const spec = e.shell.spec;
    const filler = spec.fillerKg ?? spec.massKg * 0.05;
    const blast = FORT_TUNING.blastPerRootKg * Math.sqrt(Math.max(filler, 0.5));
    for (const p of this.emplacements) {
      const d = Math.hypot(e.x - p.worldX, e.z - p.worldZ);
      const reach = Math.max(blast, p.spec.radius * FORT_TUNING.nearMissReach);
      if (d > reach) continue;
      const k = 1 - d / reach;
      // Open pits are shaken most; a casemate, little. Casualties need a fall right among the guns: further off the crews are only
      // kept down.
      const exposure = p.spec.frontMm === 0 ? 1 : 0.35;
      this.shake(p, k * (0.14 + filler / 40) * exposure, d < blast * 0.4 ? k * FORT_TUNING.nearMissCasualties * exposure : 0);
      if (d < p.spec.radius && e.kind === 'ground' && p.spec.frontMm === 0) this.burstIn(p, filler, true);
    }
    this.checkSilenced();
  }

  private checkSilenced(): void {
    if (this.silenced && !this.silencedReported) {
      this.silencedReported = true;
      this.onReport?.(`${this.name} is silenced.`);
    }
  }

  // ---- fighting ----------------------------------------------------------------------------------

  step(dt: number, now: number): ShellEvent[] {
    this.now = now;
    const g = this.gunnery;
    this.suppression = Math.max(this.suppression - FORT_TUNING.suppressionRecovery * dt, 0);
    g.visibilityKm = this.cfg.visibilityKm();
    g.world.env = this.cfg.env();
    g.fireControlHealth = Math.min(Math.max(1 - FORT_TUNING.fireControlLoss * this.suppression, 0.3), 1);
    const underCover = this.suppression >= FORT_TUNING.coverThreshold;
    this.emplacements.forEach((e, i) => {
      const ok = this.operable(e) && !underCover;
      // A thin crew and a shaken one load slowly.
      g.battery.setAvailability(i, ok, (1 + 1.6 * this.suppression) / Math.max(e.crew, 0.35));
    });

    // The captain: take the nearest enemy that can be seen, and fire when the plot is good.
    if (!this.silenced) this.chooseTarget(now);
    const target = g.target;
    const ready =
      !this.silenced &&
      !underCover &&
      target !== null &&
      g.canReach &&
      g.track.count >= 5 &&
      g.fixAge(now) < 12 &&
      this.emplacements.some((e) => this.operable(e));
    return g.update(dt, now, this.frame, ready);
  }

  private chooseTarget(now: number): void {
    const g = this.gunnery;
    const cur = g.target;
    if (cur && (cur as { alive?: boolean }).alive !== false && !cur.struck && Math.hypot(cur.x - this.x, cur.z - this.z) < this.reach) return;
    let best: Contact | null = null;
    let bestD = this.reach * 0.97;
    for (const c of this.foes) {
      if (c.alive === false || c.struck) continue;
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best !== cur) g.designate(best);
    g.autoSpot = true;
    void now;
  }

  summary(): { silenced: boolean; guns: number; total: number; suppression: number; crew: number } {
    const total = this.emplacements.length;
    const crew = this.emplacements.reduce((s, e) => s + (e.state === 'wrecked' ? 0 : e.crew), 0) / Math.max(total, 1);
    return { silenced: this.silenced, guns: this.gunsLeft, total, suppression: this.suppression, crew };
  }
}

function scaledDispersion(k: number): DispersionSpec {
  const d = DEFAULT_DISPERSION;
  return {
    velocity: d.velocity * k,
    elevation: d.elevation * k,
    azimuth: d.azimuth * k,
    salvoVelocity: d.salvoVelocity * k,
    salvoElevation: d.salvoElevation * k,
    salvoAzimuth: d.salvoAzimuth * k,
  };
}

