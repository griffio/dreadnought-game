import type { TubeBattery } from './tubes';
import { interceptCourse } from './intercept';

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

function shortest(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/** A target as the plot has it: where she is and her estimated velocity. */
export interface PlottedTarget {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface TorpedoAim {
  /** Compass heading to launch on, and relative to the bow (+ starboard), radians. */
  heading: number;
  relative: number;
  /** Distance the torpedo must run and the seconds it takes. */
  run: number;
  time: number;
  /** Where the meeting is expected, world metres. */
  aimX: number;
  aimZ: number;
  /** Within the legs of the setting. */
  inReach: boolean;
  /** Tubes loaded and fit, and how many of them can fire on this bearing. */
  loaded: number;
  bearing: number;
  /** Radians the ship must turn (+ starboard) to bring a loaded tube's arc onto the bearing; 0 when one already does. */
  turn: number;
}

/**
 * The torpedo firing solution: the course that meets the plotted target at the setting's speed, and what the tubes can do about
 * it. A fixed beam tube fires only within a narrow arc, so the usual answer is a turn.
 */
export function aimTorpedoes(
  own: { x: number; z: number; heading: number },
  target: PlottedTarget,
  speed: number,
  reach: number,
  tubes: TubeBattery,
): TorpedoAim | null {
  const sol = interceptCourse(own.x, own.z, target.x, target.z, target.vx, target.vz, speed);
  if (!sol) return null;
  const relative = shortest(0, sol.heading - own.heading);
  let loaded = 0;
  let bearing = 0;
  let turn = Number.POSITIVE_INFINITY;
  tubes.tubes.forEach((t, i) => {
    if (!t.enabled || !t.loaded) return;
    loaded++;
    if (tubes.bears(i, relative)) bearing++;
    const mid = ((t.spec.arcDeg[0] + t.spec.arcDeg[1]) / 2) * DEG;
    const half = ((t.spec.arcDeg[1] - t.spec.arcDeg[0]) / 2) * DEG;
    const d = shortest(mid, relative);
    const excess = Math.abs(d) - half;
    const need = excess <= 0 ? 0 : Math.sign(d) * excess;
    if (Math.abs(need) < Math.abs(turn)) turn = need;
  });
  return {
    heading: sol.heading,
    relative,
    run: sol.run,
    time: sol.time,
    aimX: sol.x,
    aimZ: sol.z,
    inReach: sol.run <= reach,
    loaded,
    bearing,
    turn: Number.isFinite(turn) ? turn : 0,
  };
}
