/**
 * Replay: the last minute and a half of the fight, kept as what was drawn and played back at any speed from any camera.
 *
 * It does not re-run the simulation. A replay that re-ran the fight would have to reproduce every roll of the dice and every wave
 * under every ship, and would drift the moment anything differed. This records the picture instead: at thirty samples a second
 * each ship's pose and the articulation of her turrets, and the player's shells in the air; and, as it happens, every call the
 * game makes to draw a spectacle (a muzzle blast, a splash, a burst, a puff of funnel smoke) with the simulation time it was
 * made. Playing it back sets the ships as they were, pins the ocean to the wave time they rode, and makes the same calls at the
 * same times, so the guns fire, the shells fly and fall, and the splashes rise exactly when they did.
 *
 * It needs nothing of the game but the `ReplayTarget` that applies a ship's pose, a wake sample and an effect call: that keeps
 * it testable without a GPU.
 */

/** The spectacles the game draws by calling `Effects`: the calls that are recorded, and made again in playback. */
export const RECORDED_EFFECTS = [
  'muzzleBlast',
  'shellSplash',
  'hitBurst',
  'armorSpark',
  'explosion',
  'tracer',
  'tracerTrail',
  'funnelPuff',
  'fireSmoke',
  'flame',
  'torpedoWake',
  'torpedoBlast',
  'torpedoLaunch',
  'turretWreck',
  'boil',
  'shipLost',
  'screenPuff',
  'aircraft',
  'mineMarker',
  'groundBurst',
] as const;
export type EffectName = (typeof RECORDED_EFFECTS)[number];

/** How a ship looked at an instant: where she was drawn, how she lay in the waves, and where her turrets pointed. */
export interface ShipShot {
  x: number;
  z: number;
  headingDeg: number;
  heave: number;
  pitch: number;
  roll: number;
  /** For her wake: speed over the water and the engine power ordered, 0..1. */
  speed: number;
  power: number;
  /** She is on the surface to be seen (a ship that has gone under is not). */
  visible: boolean;
  /** The articulation of her turrets (see ShipRig.snapshot). */
  guns: Float32Array;
  /** The fires burning in her, four numbers each (ship-space position, intensity), as they light her hull. */
  fires?: number[];
  /** A ship that has broken in two: where (ship-space x), how long ago, and how far on in sinking (0..1). */
  split?: { x: number; age: number; sunk: number };
}

/** A shell of the player's in the air. */
export interface ShellShot {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface ReplaySample {
  /** Simulation time, seconds. */
  t: number;
  /** The time the ocean had been advanced to, so that the sea is the sea the ships were riding. */
  sea: number;
  ships: ShipShot[];
  shells: ShellShot[];
}

export interface ReplayEvent {
  t: number;
  name: EffectName;
  args: readonly unknown[];
}

/** An array that drops from the front cheaply: the oldest go as new ones are added. */
class Window<T extends { t: number }> {
  private items: T[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }

  at(i: number): T {
    return this.items[this.head + i]!;
  }

  get last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  push(item: T): void {
    this.items.push(item);
  }

  /** Drop everything older than `t`. */
  dropBefore(t: number): void {
    while (this.head < this.items.length && this.items[this.head]!.t < t) this.head++;
    if (this.head > 2048 && this.head > this.items.length / 2) {
      this.items.splice(0, this.head);
      this.head = 0;
    }
  }

  clear(): void {
    this.items = [];
    this.head = 0;
  }

  /** The index of the first item with `item.t > t`, or `length` if there is none. */
  firstAfter(t: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.at(mid).t > t) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

/** What the recorder wraps: any object with the spectacle methods. */
type Spectacle = Record<EffectName, (...args: never[]) => unknown>;

export class ReplayRecorder {
  private readonly samples_ = new Window<ReplaySample>();
  private readonly events_ = new Window<ReplayEvent>();
  /** While true the calls made are the playback's own, and are not recorded again. */
  suspended = false;
  /** The sampling interval, seconds of simulation time. */
  private readonly interval: number;

  constructor(
    /** How much of the fight is kept, seconds. */
    readonly window = 90,
    samplesPerSecond = 30,
    /** Events are kept a little longer than samples, so that the smoke that was in the air at the start can be rebuilt. */
    private readonly warm = 30,
  ) {
    this.interval = 1 / samplesPerSecond;
  }

  get sampleCount(): number {
    return this.samples_.length;
  }

  get eventCount(): number {
    return this.events_.length;
  }

  sampleAt(i: number): ReplaySample {
    return this.samples_.at(i);
  }

  eventAt(i: number): ReplayEvent {
    return this.events_.at(i);
  }

  /** Index of the first sample / event after time `t`. */
  sampleAfter(t: number): number {
    return this.samples_.firstAfter(t);
  }

  eventAfter(t: number): number {
    return this.events_.firstAfter(t);
  }

  /** The first and last moments kept, or null when nothing has been recorded. */
  get range(): { start: number; end: number } | null {
    if (this.samples_.length < 2) return null;
    return { start: this.samples_.at(0).t, end: this.samples_.last!.t };
  }

  /**
   * Record each call to a spectacle method as it is made, with the time `clock` gives, and carry it out as before. The methods are
   * replaced on the instance, so nothing that calls them has to know.
   */
  install(target: Spectacle, clock: () => number): void {
    const methods = target as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of RECORDED_EFFECTS) {
      const original = methods[name]!.bind(target);
      methods[name] = (...args: unknown[]) => {
        if (!this.suspended) this.events_.push({ t: clock(), name, args });
        return original(...args);
      };
    }
  }

  /** Keep a sample of the ships and shells, if enough time has passed since the last one; and let go of what is too old. */
  sample(s: ReplaySample): void {
    if (this.suspended) return;
    const last = this.samples_.last;
    if (last && s.t - last.t < this.interval - 1e-9) return;
    this.samples_.push(s);
    this.samples_.dropBefore(s.t - this.window);
    this.events_.dropBefore(s.t - this.window - this.warm);
  }

  clear(): void {
    this.samples_.clear();
    this.events_.clear();
  }
}

/** Where a replay is carried out: the ships, their wakes, the effects and the clocks. */
export interface ReplayTarget {
  /** Lay ship `i` as she was. */
  applyShip(i: number, s: ShipShot): void;
  /** Add a sample to ship `i`'s wake. */
  recordWake(i: number, t: number, s: ShipShot): void;
  clearWake(): void;
  /** Make a recorded effect call. */
  fire(name: EffectName, args: readonly unknown[]): void;
  /** Throw away the smoke, spray and flames now in the air. */
  resetFx(): void;
  /** Move the smoke, spray and flames on by `dt` seconds of replay time (only while the replay is being rebuilt: the renderer does it as it plays). */
  advanceFx(dt: number): void;
  /** The wave time and the simulation time of the picture. */
  setClocks(sea: number, sim: number): void;
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

function lerpDegrees(a: number, b: number, f: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (((a + d * f) % 360) + 360) % 360;
}

export interface ReplayView {
  sea: number;
  ships: ShipShot[];
  shells: ShellShot[];
}

/** The two samples either side of `t`, and how far between them it is. */
function around(rec: ReplayRecorder, t: number): { a: ReplaySample; b: ReplaySample; f: number } | null {
  const n = rec.sampleCount;
  if (n === 0) return null;
  const i = rec.sampleAfter(t);
  if (i === 0) return { a: rec.sampleAt(0), b: rec.sampleAt(0), f: 0 };
  if (i >= n) return { a: rec.sampleAt(n - 1), b: rec.sampleAt(n - 1), f: 0 };
  const a = rec.sampleAt(i - 1);
  const b = rec.sampleAt(i);
  return { a, b, f: (t - a.t) / Math.max(b.t - a.t, 1e-9) };
}

/** The picture at time `t`: the ships' poses and the shells' positions, interpolated between the two samples either side. */
export function viewAt(rec: ReplayRecorder, t: number): ReplayView | null {
  const w = around(rec, t);
  if (!w) return null;
  const { a, b, f } = w;
  const ships = a.ships.map((sa, i) => {
    const sb = b.ships[i] ?? sa;
    return {
      x: lerp(sa.x, sb.x, f),
      z: lerp(sa.z, sb.z, f),
      headingDeg: lerpDegrees(sa.headingDeg, sb.headingDeg, f),
      heave: lerp(sa.heave, sb.heave, f),
      pitch: lerp(sa.pitch, sb.pitch, f),
      roll: lerp(sa.roll, sb.roll, f),
      speed: lerp(sa.speed, sb.speed, f),
      power: lerp(sa.power, sb.power, f),
      visible: f < 0.5 ? sa.visible : sb.visible,
      guns: f < 0.5 ? sa.guns : sb.guns,
      fires: f < 0.5 ? sa.fires : sb.fires,
      // A ship breaking between the two samples breaks at the later one; one already broken goes on from where she was.
      split: sa.split && sb.split ? { x: sb.split.x, age: lerp(sa.split.age, sb.split.age, f), sunk: lerp(sa.split.sunk, sb.split.sunk, f) } : f < 0.5 ? sa.split : sb.split,
    };
  });
  const byId = new Map(b.shells.map((s) => [s.id, s]));
  const shells: ShellShot[] = [];
  const seen = new Set<number>();
  for (const sa of a.shells) {
    seen.add(sa.id);
    const sb = byId.get(sa.id);
    shells.push(
      sb
        ? { id: sa.id, x: lerp(sa.x, sb.x, f), y: lerp(sa.y, sb.y, f), z: lerp(sa.z, sb.z, f), vx: lerp(sa.vx, sb.vx, f), vy: lerp(sa.vy, sb.vy, f), vz: lerp(sa.vz, sb.vz, f) }
        : sa,
    );
  }
  // A shell that has just left the guns is in the later sample only.
  if (f > 0.5) for (const sb of b.shells) if (!seen.has(sb.id)) shells.push(sb);
  return { sea: lerp(a.sea, b.sea, f), ships, shells };
}

/**
 * Plays a recording back: a clock that runs at a chosen speed (or stands still), and at each moment of it the ships laid as they were
 * and the effects called that were called then. `seek` goes to any moment, rebuilding the smoke that was in the air from the calls
 * made in the half minute before.
 */
export class ReplayPlayer {
  t: number;
  speed = 1;
  playing = true;
  /** The seconds of effects replayed, unseen, before the moment sought, so that smoke and wakes are already there. */
  private static readonly STEP = 1 / 30;

  constructor(
    readonly rec: ReplayRecorder,
    private readonly target: ReplayTarget,
    private readonly warm = 25,
  ) {
    this.t = rec.range?.start ?? 0;
  }

  get start(): number {
    return this.rec.range?.start ?? 0;
  }

  get end(): number {
    return this.rec.range?.end ?? 0;
  }

  /** Go to a moment of the recording, rebuilding what was in the air and in the water. */
  seek(t: number): void {
    const rec = this.rec;
    if (!rec.range) return;
    this.t = Math.min(Math.max(t, this.start), this.end);
    this.target.resetFx();
    this.target.clearWake();
    const from = Math.max(this.start, this.t - this.warm);
    for (let u = from; u < this.t; ) {
      const next = Math.min(u + ReplayPlayer.STEP, this.t);
      this.step(u, next);
      this.target.advanceFx(next - u);
      u = next;
    }
    this.apply();
  }

  /** Run the clock on by `dt` real seconds, at the replay's speed. */
  advance(dt: number): void {
    if (!this.playing || !this.rec.range) return;
    const prev = this.t;
    this.t = Math.min(prev + dt * this.speed, this.end);
    if (this.t >= this.end) this.playing = false;
    this.step(prev, this.t);
    this.apply();
  }

  /** The effects called, and the wake laid, in the time after `from` up to `to`. */
  private step(from: number, to: number): void {
    if (to <= from) return;
    const rec = this.rec;
    rec.suspended = true;
    try {
      for (let i = rec.eventAfter(from); i < rec.eventCount && rec.eventAt(i).t <= to; i++) {
        const e = rec.eventAt(i);
        this.target.fire(e.name, e.args);
      }
    } finally {
      rec.suspended = false;
    }
    for (let i = rec.sampleAfter(from); i < rec.sampleCount && rec.sampleAt(i).t <= to; i++) {
      const s = rec.sampleAt(i);
      s.ships.forEach((ship, k) => this.target.recordWake(k, s.t, ship));
    }
  }

  private apply(): void {
    const v = viewAt(this.rec, this.t);
    if (!v) return;
    v.ships.forEach((s, i) => this.target.applyShip(i, s));
    this.target.setClocks(v.sea, this.t);
  }

  /** The picture now, for the camera. */
  view(): ReplayView | null {
    return viewAt(this.rec, this.t);
  }
}
