import { angleInArc } from '../gunnery/battery';
import type { TubeSpec } from './spec';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
/** Spacing between torpedoes leaving the tubes in one fan, seconds. */
export const FAN_STAGGER_SECONDS = 0.35;
/** The most the fan is allowed to open, total degrees, and how far from the order any one torpedo may be set. */
export const MAX_SPREAD_DEG = 30;
const ALIGN_TOLERANCE = 1.5 * DEG;

export interface TubeState {
  spec: TubeSpec;
  /** Where the tube points now and where it was ordered to, radians from the bow. */
  bearing: number;
  ordered: number;
  /** A torpedo is in the tube. */
  loaded: boolean;
  /** Seconds until the next torpedo is in the tube, when it has fired one and has more. */
  reload: number;
  spare: number;
  /** False when the mounting is wrecked. */
  enabled: boolean;
}

/** One torpedo sent from one tube, `delay` seconds after the order. */
export interface TubeFiring {
  tube: number;
  /** Bearing of the run relative to the bow, radians. */
  bearing: number;
  delay: number;
}

function shortest(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/**
 * A ship's torpedo tubes. They are ordered to a launch bearing; a deck mounting trains onto it at its own rate, a fixed beam tube
 * only has the angle its gyroscope can set. A salvo fires every loaded tube that bears, spreading the torpedoes across a fan.
 */
export class TubeBattery {
  readonly tubes: TubeState[];
  /** The launch bearing last ordered, radians from the bow: a tube whose arc does not take it does not fire. */
  private requested = 0;

  constructor(specs: readonly TubeSpec[]) {
    this.tubes = specs.map((spec) => ({
      spec,
      bearing: spec.restBearingDeg * DEG,
      ordered: spec.restBearingDeg * DEG,
      loaded: true,
      reload: 0,
      spare: Math.max(spec.rounds - 1, 0),
      enabled: true,
    }));
  }

  private arc(t: TubeState): [number, number] {
    return [t.spec.arcDeg[0] * DEG, t.spec.arcDeg[1] * DEG];
  }

  /** The nearest bearing inside the tube's arc to `rel`, and whether `rel` itself is inside it. */
  private clampToArc(t: TubeState, rel: number): { bearing: number; inside: boolean } {
    const [lo, hi] = this.arc(t);
    const inside = angleInArc(rel, lo, hi);
    if (inside !== null) return { bearing: inside, inside: true };
    return { bearing: Math.abs(shortest(rel, lo)) < Math.abs(shortest(rel, hi)) ? lo : hi, inside: false };
  }

  /** Whether a launch bearing (radians from the bow) is inside tube `i`'s arc. */
  bears(i: number, rel: number): boolean {
    const t = this.tubes[i]!;
    return t.enabled && this.clampToArc(t, rel).inside;
  }

  /** Tubes that are loaded, fit and could fire on `rel`. */
  countBearing(rel: number): number {
    return this.tubes.filter((t, i) => t.enabled && t.loaded && this.bears(i, rel)).length;
  }

  order(rel: number): void {
    this.requested = rel;
    for (const t of this.tubes) t.ordered = this.clampToArc(t, rel).bearing;
  }

  get loadedCount(): number {
    return this.tubes.filter((t) => t.enabled && t.loaded).length;
  }

  get remaining(): number {
    return this.tubes.reduce((n, t) => n + (t.enabled ? (t.loaded ? 1 : 0) + t.spare : 0), 0);
  }

  update(dt: number): void {
    for (const t of this.tubes) {
      const rate = t.spec.trainRateDegPerSec * DEG * dt;
      if (t.spec.trainRateDegPerSec <= 0) {
        t.bearing = t.ordered;
      } else {
        const d = shortest(t.bearing, t.ordered);
        t.bearing += Math.min(Math.max(d, -rate), rate);
      }
      if (!t.loaded && t.spare > 0) {
        t.reload -= dt;
        if (t.reload <= 0) {
          t.loaded = true;
          t.spare--;
          t.reload = 0;
        }
      }
    }
  }

  /** Tubes ready to fire now: loaded, fit, able to take the ordered bearing, and trained onto it. */
  ready(): number[] {
    const out: number[] = [];
    this.tubes.forEach((t, i) => {
      if (t.enabled && t.loaded && this.clampToArc(t, this.requested).inside && Math.abs(shortest(t.bearing, t.ordered)) <= ALIGN_TOLERANCE) out.push(i);
    });
    return out;
  }

  /**
   * Fire a fan on the ordered bearing. `spreadDeg` is how far the fan opens in all (the outer torpedoes are half that either
   * side of the order). Returns the firings; the tubes empty and begin to reload.
   */
  fire(spreadDeg: number): TubeFiring[] {
    const tubes = this.ready();
    const spread = Math.min(Math.max(spreadDeg, 0), MAX_SPREAD_DEG) * DEG;
    const n = tubes.length;
    const out: TubeFiring[] = [];
    tubes.forEach((i, k) => {
      const t = this.tubes[i]!;
      const offset = n > 1 ? (k / (n - 1) - 0.5) * spread : 0;
      const bearing = this.clampToArc(t, t.ordered + offset).bearing;
      t.loaded = false;
      t.reload = t.spec.reloadSeconds;
      out.push({ tube: i, bearing, delay: k * FAN_STAGGER_SECONDS });
    });
    return out;
  }
}
