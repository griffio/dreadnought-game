/**
 * Wave-following for a ship hull. The water height is sampled under the hull on a small grid and a plane is
 * fitted to it; heave, pitch and roll are then low-pass filtered toward that plane by damped springs, which
 * gives a heavy ship's slow, rolling motion and ignores waves much shorter than the hull.
 *
 * Conventions: ship x is forward, z is starboard. Pitch is positive bow up; roll is positive starboard down.
 * Heading is compass degrees (0 = north = -z world, 90 = east = +x world).
 */
export interface FloatingParams {
  length: number;
  beam: number;
  /** Natural periods (s) of the three motions. */
  heavePeriod: number;
  pitchPeriod: number;
  rollPeriod: number;
  /** Damping ratio (1 = critical). */
  damping: number;
  /** How much of the wave slope the hull follows (0..1). */
  waveFollowing: number;
}

export const BATTLESHIP_FLOATING = (length: number, beam: number): FloatingParams => ({
  length,
  beam,
  heavePeriod: 6.5,
  pitchPeriod: 7.5,
  rollPeriod: 11,
  damping: 0.45,
  waveFollowing: 0.9,
});

export interface WaterPlane {
  /** Mean water height under the hull (m). */
  height: number;
  /** Slope along the ship (dh/dx_local) and across it (dh/dz_local). */
  slopeX: number;
  slopeZ: number;
}

/**
 * Fit h = h0 + a*x + b*z to water heights on a mid-point grid under the hull (8 along x over 90% of the
 * length, 6 across the beam). Mid-point sampling averages waves about one hull dimension long to nearly
 * zero instead of aliasing them into heave, as a corner-only grid would.
 */
export function fitWaterPlane(
  heightAt: (worldX: number, worldZ: number) => number,
  px: number,
  pz: number,
  headingDeg: number,
  length: number,
  beam: number,
): WaterPlane {
  const h = (headingDeg * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const sx = Math.cos(h);
  const sz = Math.sin(h);
  const ROWS = 8;
  const COLS = 6;
  let sum = 0;
  let sumX = 0;
  let sumZ = 0;
  let sxx = 0;
  let szz = 0;
  for (let i = 0; i < ROWS; i++) {
    const x = ((i + 0.5) / ROWS - 0.5) * 0.9 * length;
    for (let j = 0; j < COLS; j++) {
      const z = ((j + 0.5) / COLS - 0.5) * beam;
      const height = heightAt(px + fx * x + sx * z, pz + fz * x + sz * z);
      sum += height;
      sumX += x * height;
      sumZ += z * height;
      sxx += x * x;
      szz += z * z;
    }
  }
  return { height: sum / (ROWS * COLS), slopeX: sumX / sxx, slopeZ: sumZ / szz };
}

export class FloatingBody {
  heave = 0;
  pitch = 0;
  roll = 0;
  private vHeave = 0;
  private vPitch = 0;
  private vRoll = 0;

  constructor(readonly params: FloatingParams) {}

  /**
   * `extraRoll` is added to the roll target (radians, + starboard down): the lean of a turn, or a list from flooding.
   * `extraPitch` (+ bow up) is trim, and `sink` (metres) how far the ship has settled in the water.
   */
  update(dt: number, plane: WaterPlane, extraRoll = 0, extraPitch = 0, sink = 0): void {
    const p = this.params;
    const targets = {
      heave: plane.height - sink,
      pitch: Math.atan(plane.slopeX) * p.waveFollowing + extraPitch,
      roll: -Math.atan(plane.slopeZ) * p.waveFollowing + extraRoll,
    };
    // Sub-step so large frame times cannot destabilise the integration.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vHeave = this.spring(this.heave, this.vHeave, targets.heave, p.heavePeriod, h);
      this.heave += this.vHeave * h;
      this.vPitch = this.spring(this.pitch, this.vPitch, targets.pitch, p.pitchPeriod, h);
      this.pitch += this.vPitch * h;
      this.vRoll = this.spring(this.roll, this.vRoll, targets.roll, p.rollPeriod, h);
      this.roll += this.vRoll * h;
    }
  }

  /** Put her at rest on the water as it is (no transient from a hull that began level at height zero): the targets of `update`, still. */
  settle(plane: WaterPlane, extraRoll = 0, extraPitch = 0, sink = 0): void {
    const p = this.params;
    this.heave = plane.height - sink;
    this.pitch = Math.atan(plane.slopeX) * p.waveFollowing + extraPitch;
    this.roll = -Math.atan(plane.slopeZ) * p.waveFollowing + extraRoll;
    this.vHeave = 0;
    this.vPitch = 0;
    this.vRoll = 0;
  }

  /** Add an impulse (for example a salvo's recoil): rad/s to roll and pitch. */
  kick(rollRate: number, pitchRate: number): void {
    this.vRoll += rollRate;
    this.vPitch += pitchRate;
  }

  private spring(x: number, v: number, target: number, period: number, dt: number): number {
    const w = (2 * Math.PI) / period;
    const accel = w * w * (target - x) - 2 * this.params.damping * w * v;
    return v + accel * dt;
  }
}
