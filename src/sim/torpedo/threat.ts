const TWO_PI = Math.PI * 2;

/** The ship that must be kept out of the way: where she is, how she moves and how big she is. */
export interface OwnShip {
  x: number;
  z: number;
  /** Compass heading, radians, and speed over the ground, m/s. */
  heading: number;
  speed: number;
  halfLength: number;
  halfBeam: number;
}

export interface RunningTorpedo {
  x: number;
  z: number;
  /** Compass heading, radians. */
  heading: number;
  speed: number;
  /** Distance run so far and how far it can run. */
  run: number;
  maxRun: number;
}

export type ThreatLevel = 'hit' | 'close' | 'clear';

/** What the bridge makes of a wake it has seen. */
export interface ThreatView {
  /** Compass bearing of the torpedo from the ship, radians, and relative to her bow (+ starboard), -pi..pi. */
  bearing: number;
  relative: number;
  range: number;
  /** Seconds until it reaches her (or the nearest it will come), when it is closing and has the legs for it. */
  eta: number | null;
  /** How far from her centre it passes, metres, on both courses held. */
  miss: number | null;
  level: ThreatLevel;
}

function wrap(a: number): number {
  let d = a % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * Where a torpedo will pass the ship if neither alters course: the closest approach on the relative track, and whether the hull
 * (a rectangle as seen along that track) is in the way. 'hit' when the track crosses her outline, 'close' within a hull's length
 * of it, otherwise 'clear'.
 */
export function assessTorpedo(t: RunningTorpedo, own: OwnShip): ThreatView {
  const rx = t.x - own.x;
  const rz = t.z - own.z;
  const range = Math.hypot(rx, rz);
  const bearing = (Math.atan2(rx, -rz) + TWO_PI) % TWO_PI;
  const relative = wrap(bearing - own.heading);

  const tvx = Math.sin(t.heading) * t.speed;
  const tvz = -Math.cos(t.heading) * t.speed;
  const ovx = Math.sin(own.heading) * own.speed;
  const ovz = -Math.cos(own.heading) * own.speed;
  const vx = tvx - ovx;
  const vz = tvz - ovz;
  const v2 = vx * vx + vz * vz;
  if (v2 < 1e-6) return { bearing, relative, range, eta: null, miss: null, level: 'clear' };
  // Time of closest approach on the relative track.
  const tc = -(rx * vx + rz * vz) / v2;
  const remaining = Math.max(t.maxRun - t.run, 0) / Math.max(t.speed, 0.1);
  if (tc <= 0) return { bearing, relative, range, eta: null, miss: null, level: 'clear' };
  // One that runs out of legs before its closest approach is judged where it stops: inside the hull is still a hit.
  const tEval = Math.min(tc, remaining);
  const cx = rx + vx * tEval;
  const cz = rz + vz * tEval;
  const miss = Math.hypot(cx, cz);
  // The hull's width across the relative track: her length when the track runs abeam, her beam when it runs along her.
  const relHeading = Math.atan2(vx, -vz);
  const phi = wrap(relHeading - own.heading);
  const across = Math.abs(Math.sin(phi)) * own.halfLength + Math.abs(Math.cos(phi)) * own.halfBeam;
  // Where the relative track passes, perpendicular to itself: |cx, cz| is already the closest distance to her centre.
  if (tc > remaining && miss > across) return { bearing, relative, range, eta: null, miss: null, level: 'clear' };
  const level: ThreatLevel = miss <= across ? 'hit' : miss <= across + own.halfLength ? 'close' : 'clear';
  return { bearing, relative, range, eta: tEval, miss, level };
}
