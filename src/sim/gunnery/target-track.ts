/**
 * Target tracking, the heart of the plotting table. Each observation of the target (own position, measured range and
 * bearing) becomes a world position; a recency-weighted least-squares line through the recent ones gives the
 * target's position and velocity. A target on a steady course settles in about a minute; when it turns or
 * zigzags the old samples disagree with the new course and the estimate is wrong until they age out.
 */
export interface TrackEstimate {
  /** World position at `now`, metres. */
  x: number;
  z: number;
  /** Velocity, m/s. */
  vx: number;
  vz: number;
  /** One-sigma uncertainty of the speed estimate, m/s. Large until the plot has spanned enough time. */
  sigmaSpeed: number;
  samples: number;
}

interface Sample {
  t: number;
  x: number;
  z: number;
}

/** Typical speed spread of a warship, m/s, the prior the estimate is shrunk toward; and the most any ship is allowed. */
const SPEED_PRIOR = 9;
const MAX_SPEED = 25;
const RANGING_UNCERTAINTY = 2.5;

export class TargetTrack {
  private samples: Sample[] = [];

  constructor(
    /** Observations older than this are dropped, seconds. */
    private readonly window = 75,
    /** Recency weighting time constant, seconds. */
    private readonly weightTau = 40,
  ) {}

  get count(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }

  /** Forget everything older than `keep` seconds: the plot restarts after the target has turned. */
  trim(now: number, keep: number): void {
    this.samples = this.samples.filter((p) => now - p.t <= keep);
  }

  /** Seconds the plot spans, 0 when empty. */
  span(now: number): number {
    return this.samples.length === 0 ? 0 : now - this.samples[0]!.t;
  }

  /** Record an observation: bearing is the compass bearing of the target from the observer, radians. */
  observe(t: number, ownX: number, ownZ: number, range: number, bearing: number): void {
    this.samples.push({ t, x: ownX + Math.sin(bearing) * range, z: ownZ - Math.cos(bearing) * range });
    while (this.samples.length > 0 && t - this.samples[0]!.t > this.window) this.samples.shift();
  }

  estimate(now: number, positionSigma = 40): TrackEstimate | null {
    const s = this.samples;
    if (s.length === 0) return null;
    if (s.length < 3 || now - s[0]!.t < 6) {
      const last = s[s.length - 1]!;
      return { x: last.x, z: last.z, vx: 0, vz: 0, sigmaSpeed: 99, samples: s.length };
    }
    // Weighted least squares of position against time, centred on `now`.
    let sw = 0;
    let st = 0;
    let stt = 0;
    let sx = 0;
    let sz = 0;
    let stx = 0;
    let stz = 0;
    for (const p of s) {
      const w = Math.exp(-(now - p.t) / this.weightTau);
      const dt = p.t - now;
      sw += w;
      st += w * dt;
      stt += w * dt * dt;
      sx += w * p.x;
      sz += w * p.z;
      stx += w * dt * p.x;
      stz += w * dt * p.z;
    }
    const det = sw * stt - st * st;
    if (Math.abs(det) < 1e-9) {
      const last = s[s.length - 1]!;
      return { x: last.x, z: last.z, vx: 0, vz: 0, sigmaSpeed: 99, samples: s.length };
    }
    const vx = (sw * stx - st * sx) / det;
    const vz = (sw * stz - st * sz) / det;
    const x = (sx - vx * st) / sw;
    const z = (sz - vz * st) / sw;
    // The variance of a fitted slope is sigma^2 * sw / det.
    const sigmaSpeed = positionSigma * Math.sqrt(sw / det);
    // Ships do not go much faster than twenty knots or so. Before the plot is long enough to say, the estimate is pulled
    // toward "not moving" in proportion to how uncertain it is (a prior of about 9 m/s against the fitted slope's variance),
    // so a few noisy early readings cannot send the guns after a ship doing 60 m/s.
    // The ranging error behind it is several times the nominal position sigma used for the HUD's "settled" criterion.
    const honest = sigmaSpeed * RANGING_UNCERTAINTY;
    const k = (SPEED_PRIOR * SPEED_PRIOR) / (SPEED_PRIOR * SPEED_PRIOR + honest * honest);
    let svx = vx * k;
    let svz = vz * k;
    const speed = Math.hypot(svx, svz);
    if (speed > MAX_SPEED) {
      svx *= MAX_SPEED / speed;
      svz *= MAX_SPEED / speed;
    }
    return { x, z, vx: svx, vz: svz, sigmaSpeed, samples: s.length };
  }
}
