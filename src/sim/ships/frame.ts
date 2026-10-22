/**
 * Where a ship is and how it sits on the water, as the simulation needs it: enough to turn a point on the ship (ship
 * space: +x bow, +y up, +z starboard) into a world position. Matches `shipBasis` in the renderer, which a test checks.
 */
export interface ShipFrame {
  x: number;
  /** Height of the waterline origin above mean sea level (heave). */
  y: number;
  z: number;
  /** Compass heading, radians. */
  heading: number;
  /** Positive bow up, radians. */
  pitch: number;
  /** Positive starboard down, radians. */
  roll: number;
  /** Ship velocity over the ground, m/s. */
  vx: number;
  vz: number;
}

export function shipFrameAt(x: number, z: number, headingRad: number): ShipFrame {
  return { x, y: 0, z, heading: headingRad, pitch: 0, roll: 0, vx: 0, vz: 0 };
}

export function shipPointToWorld(f: ShipFrame, local: readonly [number, number, number]): [number, number, number] {
  const sh = Math.sin(f.heading);
  const ch = Math.cos(f.heading);
  const cp = Math.cos(f.pitch);
  const sp = Math.sin(f.pitch);
  const forward: [number, number, number] = [sh * cp, sp, -ch * cp];
  const s0: [number, number, number] = [ch, 0, sh];
  // up0 = normalize(s0 x forward)
  let ux = s0[1] * forward[2] - s0[2] * forward[1];
  let uy = s0[2] * forward[0] - s0[0] * forward[2];
  let uz = s0[0] * forward[1] - s0[1] * forward[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const cr = Math.cos(f.roll);
  const sr = Math.sin(f.roll);
  const starboard: [number, number, number] = [s0[0] * cr - ux * sr, s0[1] * cr - uy * sr, s0[2] * cr - uz * sr];
  const up: [number, number, number] = [ux * cr + s0[0] * sr, uy * cr + s0[1] * sr, uz * cr + s0[2] * sr];
  return [
    f.x + forward[0] * local[0] + up[0] * local[1] + starboard[0] * local[2],
    f.y + forward[1] * local[0] + up[1] * local[1] + starboard[1] * local[2],
    f.z + forward[2] * local[0] + up[2] * local[1] + starboard[2] * local[2],
  ];
}
