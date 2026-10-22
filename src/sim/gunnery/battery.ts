import type { Rng } from '../rng';
import { shipPointToWorld, type ShipFrame } from '../ships/frame';
import { DEFAULT_DISPERSION, newSalvoBias, shotJitter, type DispersionSpec, type SalvoBias } from './dispersion';
import type { GunSpec } from './guns';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** Seconds between turrets in a ripple, and between the barrels of one turret. */
export const RIPPLE_SECONDS = 0.28;
export const GUN_STAGGER_SECONDS = 0.07;
/** How closely a turret must match its ordered training and elevation before it is "on" (radians). */
export const TRAIN_TOLERANCE = 0.4 * DEG;
export const ELEVATION_TOLERANCE = 0.15 * DEG;
/** Fraction of the turrets that bear which must be loaded before a requested salvo goes. */
const SALVO_THRESHOLD = 0.7;
/** Once the first loaded turret is on target, wait this long for the others before firing without them. */
const ALIGN_PATIENCE_SECONDS = 8;
/** Fraction of the ship's pitch and roll the stabilised director fails to take out of the aim. */
const GYRO_RESIDUAL = 0.03;
/** Slide of a barrel in recoil, metres, and the time constants of the stroke. */
export const RECOIL_METRES = 1.15;
const RECOIL_OUT_SECONDS = 0.1;
const RECOIL_RETURN_SECONDS = 0.85;

export interface TurretMount {
  id: string;
  /** Vertical training axis, ship space. */
  axis: readonly [number, number, number];
  /** Trunnion per barrel, ship space. */
  trunnions: readonly (readonly [number, number, number])[];
  barrelLength: number;
  restTrainRad: number;
  /** Training stops, radians clockwise from the bow (one contiguous range, may exceed pi for aft turrets). */
  trainMinRad: number;
  trainMaxRad: number;
}

/** One shell leaving a muzzle. Azimuth and elevation already include dispersion; the shell also inherits the ship's velocity. */
export interface MuzzleShot {
  salvo: number;
  turret: number;
  gun: number;
  /** World position of the muzzle. */
  muzzle: [number, number, number];
  /** Compass azimuth (radians) and elevation, with this shot's scatter. */
  azimuth: number;
  elevation: number;
  velocityScale: number;
  shipVx: number;
  shipVz: number;
  /** Unit direction of the barrel in world space, for the muzzle blast. */
  direction: [number, number, number];
}

export interface SalvoStart {
  id: number;
  shells: number;
  time: number;
}

export interface TurretStatus {
  id: string;
  /** False when the turret is out of action (wrecked, jammed, no ammunition, no crew). */
  enabled: boolean;
  /** The ordered bearing is inside this turret's arc. */
  bears: boolean;
  /** 0 just fired .. 1 loaded. */
  loaded: number;
  aligned: boolean;
  firing: boolean;
}

interface Turret {
  mount: TurretMount;
  /** Fit to fire: damage can switch a turret off. */
  enabled: boolean;
  /** Multiplier on reload time for want of a full crew. */
  reloadFactor: number;
  train: number;
  elev: number;
  orderedTrain: number;
  orderedElev: number;
  /** The world compass azimuth the turret was ordered to (the train follows it as the ship turns). */
  orderedAzimuth: number;
  bears: boolean;
  reload: number;
  reloadTotal: number;
  /** Barrels still to fire in the current salvo, with the clock time each is due. */
  queue: { gun: number; at: number; salvo: number }[];
  /** Clock time each barrel last fired. */
  firedAt: number[];
}

/** Ship-space position of a barrel's muzzle for a given training (radians from the bow) and elevation. */
export function muzzleShipSpace(mount: TurretMount, gun: number, train: number, elev: number): [number, number, number] {
  const t = mount.trunnions[gun]!;
  const mx = t[0] + mount.barrelLength * Math.cos(elev);
  const my = t[1] + mount.barrelLength * Math.sin(elev);
  const dx = mx - mount.axis[0];
  const dz = t[2] - mount.axis[2];
  const c = Math.cos(train);
  const s = Math.sin(train);
  return [mount.axis[0] + dx * c - dz * s, my, mount.axis[2] + dx * s + dz * c];
}

/** Find the equivalent of `angle` (mod 2 pi) inside [min, max], or null if the arc excludes it. */
export function angleInArc(angle: number, min: number, max: number): number | null {
  let a = angle - Math.floor((angle - min) / TWO_PI) * TWO_PI; // now in [min, min + 2 pi)
  if (a <= max + 1e-9) return a;
  a -= TWO_PI;
  return a >= min - 1e-9 ? a : null;
}

/**
 * The ship's guns: turrets that slew to ordered bearings inside their arcs, load, and fire salvos in a ripple with
 * dispersion. It knows nothing about targets; the director feeds it a world azimuth and elevation.
 */
export class GunBattery {
  readonly turrets: Turret[];
  private clock = 0;
  private salvoCounter = 0;
  private bias: SalvoBias = { velocity: 0, elevation: 0, azimuth: 0 };
  private alignWait = 0;
  private started: SalvoStart[] = [];
  private kickAccum = { roll: 0, pitch: 0 };

  constructor(
    mounts: readonly TurretMount[],
    readonly gun: GunSpec,
    private readonly rng: Rng,
    readonly dispersion: DispersionSpec = DEFAULT_DISPERSION,
  ) {
    this.turrets = mounts.map((mount) => ({
      mount,
      enabled: true,
      reloadFactor: 1,
      train: mount.restTrainRad,
      elev: 0,
      orderedTrain: mount.restTrainRad,
      orderedElev: 0,
      orderedAzimuth: 0,
      bears: false,
      reload: 0,
      reloadTotal: gun.reloadSeconds,
      queue: [],
      firedAt: mount.trunnions.map(() => Number.NEGATIVE_INFINITY),
    }));
  }

  /** Damage switches a turret on or off and slows its reload when its crew is thin. */
  setAvailability(index: number, enabled: boolean, reloadFactor: number): void {
    const t = this.turrets[index]!;
    if (t.enabled && !enabled) {
      t.queue = [];
      t.bears = false;
    }
    t.enabled = enabled;
    t.reloadFactor = reloadFactor;
  }

  /** Order the whole battery to a world compass azimuth and an elevation (radians), given the ship's heading. */
  order(azimuth: number, elevation: number, headingRad: number): void {
    for (let i = 0; i < this.turrets.length; i++) this.orderTurret(i, azimuth, elevation, headingRad);
  }

  /** Order one turret (each stands somewhere else, so each has its own answer to the same aim point). */
  orderTurret(index: number, azimuth: number, elevation: number, headingRad: number): void {
    const t = this.turrets[index]!;
    t.orderedAzimuth = azimuth;
    this.resolveTrain(t, headingRad);
    t.orderedElev = Math.min(Math.max(elevation, this.gun.minElevationDeg * DEG), this.gun.maxElevationDeg * DEG);
  }

  /** Turn the ordered world azimuth into a train angle inside the turret's arc for this heading. */
  private resolveTrain(t: Turret, headingRad: number): void {
    const rel = t.orderedAzimuth - headingRad;
    const { trainMinRad: lo, trainMaxRad: hi } = t.mount;
    const inside = angleInArc(rel, lo, hi);
    if (inside !== null) {
      t.orderedTrain = inside;
      t.bears = t.enabled;
    } else {
      // Out of arc: wait at the nearer stop.
      t.orderedTrain = Math.abs(angleDiff(rel, lo)) < Math.abs(angleDiff(rel, hi)) ? lo : hi;
      t.bears = false;
    }
  }

  /** Turrets that bear, are loaded, and are on target. */
  get readyCount(): number {
    return this.turrets.filter((t) => this.isReady(t)).length;
  }

  get bearingCount(): number {
    return this.turrets.filter((t) => t.bears).length;
  }

  /** Barrels in turrets that bear. */
  get bearingGuns(): number {
    return this.turrets.reduce((n, t) => n + (t.bears ? t.mount.trunnions.length : 0), 0);
  }

  status(): TurretStatus[] {
    return this.turrets.map((t) => ({
      id: t.mount.id,
      enabled: t.enabled,
      bears: t.bears,
      loaded: t.reload <= 0 ? 1 : 1 - t.reload / t.reloadTotal,
      aligned: this.isAligned(t),
      firing: t.queue.length > 0,
    }));
  }

  /** Salvos begun since the last call (so the owner can track their shells). */
  drainStartedSalvos(): SalvoStart[] {
    const out = this.started;
    this.started = [];
    return out;
  }

  /** Recoil and roll/pitch impulses accumulated since the last call, for the ship's body. */
  drainKick(): { roll: number; pitch: number } {
    const k = this.kickAccum;
    this.kickAccum = { roll: 0, pitch: 0 };
    return k;
  }

  /** Slide (metres, positive) of a barrel in recoil right now. */
  recoil(turret: number, gun: number): number {
    const since = this.clock - this.turrets[turret]!.firedAt[gun]!;
    if (since < 0) return 0;
    const stroke = since < RECOIL_OUT_SECONDS ? since / RECOIL_OUT_SECONDS : Math.exp(-(since - RECOIL_OUT_SECONDS) / RECOIL_RETURN_SECONDS);
    return stroke * RECOIL_METRES;
  }

  /**
   * Advance by `dt`. `trigger` is the fire request: while held, a salvo goes as soon as enough of the turrets that bear are
   * loaded and on target. Returns the shells that left a muzzle during this step.
   */
  update(dt: number, ship: ShipFrame, trigger: boolean): MuzzleShot[] {
    this.clock += dt;
    const trainRate = this.gun.trainRateDegPerSec * DEG * dt;
    const elevRate = this.gun.elevationRateDegPerSec * DEG * dt;
    for (const t of this.turrets) {
      // The order is a bearing on the sea, so as the ship turns the turret's own train order moves with it.
      this.resolveTrain(t, ship.heading);
      t.train += clamp(t.orderedTrain - t.train, -trainRate, trainRate);
      t.train = clamp(t.train, t.mount.trainMinRad, t.mount.trainMaxRad);
      t.elev += clamp(t.orderedElev - t.elev, -elevRate, elevRate);
      if (t.reload > 0) t.reload = Math.max(0, t.reload - dt);
    }

    if (trigger) this.considerSalvo(dt);
    else this.alignWait = 0;

    return this.emitDueShots(ship);
  }

  /** Fire every loaded turret now, wherever it is pointing (test fire and the showcase button). */
  fireAll(): void {
    const loaded = this.turrets.filter((t) => t.enabled && t.reload <= 0 && t.queue.length === 0);
    if (loaded.length > 0) this.beginSalvo(loaded);
  }

  private isAligned(t: Turret): boolean {
    return Math.abs(t.train - t.orderedTrain) <= TRAIN_TOLERANCE && Math.abs(t.elev - t.orderedElev) <= ELEVATION_TOLERANCE;
  }

  private isLoaded(t: Turret): boolean {
    return t.enabled && t.reload <= 0 && t.queue.length === 0;
  }

  private isReady(t: Turret): boolean {
    return t.bears && this.isLoaded(t) && this.isAligned(t);
  }

  private considerSalvo(dt: number): void {
    const bearing = this.turrets.filter((t) => t.bears);
    if (bearing.length === 0) return;
    const loaded = bearing.filter((t) => this.isLoaded(t));
    if (loaded.length < Math.ceil(bearing.length * SALVO_THRESHOLD)) {
      this.alignWait = 0;
      return;
    }
    const ready = loaded.filter((t) => this.isAligned(t));
    // The patience clock starts when the first turret is on, not while everyone is still slewing.
    this.alignWait = ready.length > 0 ? this.alignWait + dt : 0;
    if (ready.length === loaded.length || this.alignWait > ALIGN_PATIENCE_SECONDS) {
      this.beginSalvo(ready);
      this.alignWait = 0;
    }
  }

  private beginSalvo(turrets: Turret[]): void {
    const id = ++this.salvoCounter;
    this.bias = newSalvoBias(this.rng, this.dispersion);
    // Ripple from the bow aft.
    const ordered = [...turrets].sort((a, b) => b.mount.axis[0] - a.mount.axis[0]);
    let shells = 0;
    ordered.forEach((t, rank) => {
      t.queue = t.mount.trunnions.map((_, gun) => ({
        gun,
        at: this.clock + rank * RIPPLE_SECONDS + gun * GUN_STAGGER_SECONDS,
        salvo: id,
      }));
      shells += t.queue.length;
      // Crews differ by a few per cent, which also spreads the battery's reloads a little.
      t.reloadTotal = this.gun.reloadSeconds * t.reloadFactor * (0.97 + 0.06 * this.rng.next());
      t.reload = t.reloadTotal;
    });
    this.started.push({ id, shells, time: this.clock });
  }

  private emitDueShots(ship: ShipFrame): MuzzleShot[] {
    const out: MuzzleShot[] = [];
    this.turrets.forEach((t, ti) => {
      if (t.queue.length === 0) return;
      const due = t.queue.filter((q) => q.at <= this.clock);
      if (due.length === 0) return;
      t.queue = t.queue.filter((q) => q.at > this.clock);
      for (const q of due) {
        out.push(this.shot(ship, ti, t, q.gun, q.salvo));
        t.firedAt[q.gun] = this.clock;
        // A broadside shoves the ship away from the side it fires on, and the muzzle blast pitches the bow down a little.
        const rel = t.train;
        this.kickAccum.roll += -Math.sin(rel) * 0.0016;
        this.kickAccum.pitch += -Math.cos(rel) * 0.0007;
      }
    });
    return out;
  }

  private shot(ship: ShipFrame, ti: number, t: Turret, gun: number, salvo: number): MuzzleShot {
    const local = muzzleShipSpace(t.mount, gun, t.train, t.elev);
    const muzzle = shipPointToWorld(ship, local);
    const j = shotJitter(this.rng, this.dispersion, this.bias);
    // The director stabilises the aim, but not perfectly: a fraction of the ship's pitch and roll remains.
    const gyro = GYRO_RESIDUAL * (ship.pitch * Math.cos(t.train) - ship.roll * Math.sin(t.train));
    const azimuth = ship.heading + t.train + j.dAzimuth;
    const elevation = t.elev + j.dElevation + gyro;
    const ce = Math.cos(elevation);
    return {
      salvo,
      turret: ti,
      gun,
      muzzle,
      azimuth,
      elevation,
      velocityScale: j.velocityScale,
      shipVx: ship.vx,
      shipVz: ship.vz,
      direction: [Math.sin(azimuth) * ce, Math.sin(elevation), -Math.cos(azimuth) * ce],
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Signed difference a - b wrapped to (-pi, pi]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}
