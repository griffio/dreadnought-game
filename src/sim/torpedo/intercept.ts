export interface InterceptSolution {
  /** Compass heading to run on, radians. */
  heading: number;
  /** Seconds to the meeting. */
  time: number;
  /** Where they meet, world metres. */
  x: number;
  z: number;
  /** Distance the torpedo runs, metres. */
  run: number;
}

/**
 * The course a torpedo must be set on to meet a target steaming a steady course, and when. The torpedo runs straight at
 * `speed` through the water from `(ox, oz)`; the target is at `(tx, tz)` moving `(vx, vz)`. Null when the target is faster than
 * the torpedo and running away.
 */
export function interceptCourse(
  ox: number,
  oz: number,
  tx: number,
  tz: number,
  vx: number,
  vz: number,
  speed: number,
): InterceptSolution | null {
  const dx = tx - ox;
  const dz = tz - oz;
  const a = vx * vx + vz * vz - speed * speed;
  const b = 2 * (dx * vx + dz * vz);
  const c = dx * dx + dz * dz;
  let t: number | null = null;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    const positives = [t1, t2].filter((x) => x > 0);
    t = positives.length > 0 ? Math.min(...positives) : null;
  }
  if (t === null || !(t > 0)) return null;
  const x = tx + vx * t;
  const z = tz + vz * t;
  return { heading: Math.atan2(x - ox, -(z - oz)), time: t, x, z, run: speed * t };
}
