import { fromBasis, type Mat4 } from '../../math/mat4';
import { cross, degToRad, normalize, type Vec3 } from '../../math/vec3';

/** Where a ship is and how it sits on the water. Heading is compass degrees; pitch/roll are radians. */
export interface ShipPose {
  /** World x, z (metres, float64). */
  x: number;
  z: number;
  headingDeg: number;
  /** Vertical offset of the waterline origin above mean sea level (heave). */
  heave: number;
  /** Positive bow up. */
  pitch: number;
  /** Positive starboard down. */
  roll: number;
}

export interface ShipBasis {
  forward: Vec3;
  up: Vec3;
  starboard: Vec3;
}

/** World-space axes of the ship: x forward, y up, z starboard (right-handed, forward x up = starboard). */
export function shipBasis(p: ShipPose): ShipBasis {
  const h = degToRad(p.headingDeg);
  const cp = Math.cos(p.pitch);
  const forward: Vec3 = [Math.sin(h) * cp, Math.sin(p.pitch), -Math.cos(h) * cp];
  const s0: Vec3 = [Math.cos(h), 0, Math.sin(h)];
  const u0 = normalize(cross(s0, forward));
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  // Roll about the forward axis; positive lowers the starboard side.
  const starboard: Vec3 = [s0[0] * cr - u0[0] * sr, s0[1] * cr - u0[1] * sr, s0[2] * cr - u0[2] * sr];
  const up: Vec3 = [u0[0] * cr + s0[0] * sr, u0[1] * cr + s0[1] * sr, u0[2] * cr + s0[2] * sr];
  return { forward, up, starboard };
}

/** Ship space -> camera-relative world matrix (translation computed in float64 before narrowing). */
export function shipModelMatrix(p: ShipPose, cameraPos: Vec3, out: Mat4): Mat4 {
  const { forward, up, starboard } = shipBasis(p);
  return fromBasis(forward, up, starboard, [p.x - cameraPos[0], p.heave - cameraPos[1], p.z - cameraPos[2]], out);
}
