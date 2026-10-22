import { airDensity, speedOfSound } from './atmosphere';

/**
 * Exterior ballistics for naval shells: point-mass flight with quadratic drag against a Mach-dependent drag
 * coefficient, air density that thins with altitude, wind, and optional Coriolis deflection.
 *
 * World axes: x east, y up, z south (so compass heading 0 = north = -z). Sea level is y = 0.
 */
export const GRAVITY = 9.81;
const EARTH_OMEGA = 7.2921e-5;

export interface ShellSpec {
  massKg: number;
  diameterM: number;
  /** Muzzle velocity, m/s. */
  muzzleVelocity: number;
  /**
   * Scales the reference drag curve to this projectile's shape: 1.0 is the reference long ogive, larger is blunter
   * (a capped armour-piercing shell), smaller is more streamlined. The one calibration constant per shell.
   */
  formFactor: number;
  /** Mass of the bursting charge, kg. Defaults to 5% of the shell: a common pointed capped round, not a pure armour-piercer. */
  fillerKg?: number;
  /**
   * 'delay' (the default) is an armour-piercing base fuze: it starts only on a substantial plate and bursts a moment later,
   * deep inside. 'impact' bursts on the first solid thing it meets, which suits a light shell against a ship's upperworks.
   */
  fuze?: 'delay' | 'impact';
}

export interface Environment {
  /** Wind velocity, m/s (the direction the air is moving toward). */
  windX: number;
  windZ: number;
  /** Latitude in degrees for Coriolis; null disables it. */
  coriolisLatitudeDeg: number | null;
  /** Multiplier on air density (weather, temperature). */
  densityScale: number;
}

export const CALM: Environment = { windX: 0, windZ: 0, coriolisLatitudeDeg: null, densityScale: 1 };

// Reference drag coefficient against Mach number: a long boat-tailed ogive projectile (G7-shaped).
const MACH = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.4, 1.6, 2.0, 2.5, 3.0];
const CD = [0.12, 0.12, 0.121, 0.124, 0.147, 0.183, 0.38, 0.401, 0.402, 0.396, 0.372, 0.347, 0.298, 0.255, 0.23];

function dragExact(mach: number): number {
  if (mach <= MACH[0]!) return CD[0]!;
  for (let i = 1; i < MACH.length; i++) {
    if (mach <= MACH[i]!) {
      const t = (mach - MACH[i - 1]!) / (MACH[i]! - MACH[i - 1]!);
      return CD[i - 1]! + (CD[i]! - CD[i - 1]!) * t;
    }
  }
  return CD[CD.length - 1]!;
}

// The same curve sampled every 0.01 Mach so the integrator's inner loop is an index and a blend, not a search.
const DRAG_STEPS = 400;
const dragTable = new Float64Array(DRAG_STEPS + 2);
for (let i = 0; i < dragTable.length; i++) dragTable[i] = dragExact(i / 100);

export function dragCoefficient(mach: number): number {
  const f = Math.min(Math.max(mach, 0), DRAG_STEPS / 100) * 100;
  const i = Math.floor(f);
  const t = f - i;
  return dragTable[i]! * (1 - t) + dragTable[i + 1]! * t;
}

export interface ShellState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since firing. */
  t: number;
}

/** Launch state from a muzzle position, a compass azimuth and an elevation (radians), plus the firing ship's velocity. */
export function launch(
  spec: ShellSpec,
  muzzle: readonly [number, number, number],
  azimuth: number,
  elevation: number,
  shipVelocity: readonly [number, number] = [0, 0],
  velocityScale = 1,
): ShellState {
  const v = spec.muzzleVelocity * velocityScale;
  const ce = Math.cos(elevation);
  return {
    x: muzzle[0],
    y: muzzle[1],
    z: muzzle[2],
    vx: Math.sin(azimuth) * ce * v + shipVelocity[0],
    vy: Math.sin(elevation) * v,
    vz: -Math.cos(azimuth) * ce * v + shipVelocity[1],
    t: 0,
  };
}

function acceleration(
  s: ShellState,
  vx: number,
  vy: number,
  vz: number,
  y: number,
  spec: ShellSpec,
  env: Environment,
  area: number,
  out: [number, number, number],
): void {
  const rx = vx - env.windX;
  const rz = vz - env.windZ;
  const speed = Math.sqrt(rx * rx + vy * vy + rz * rz);
  const mach = speed / speedOfSound(y);
  const rho = airDensity(Math.max(y, 0)) * env.densityScale;
  const k = (0.5 * rho * dragCoefficient(mach) * spec.formFactor * area * speed) / spec.massKg;
  out[0] = -k * rx;
  out[1] = -GRAVITY - k * vy;
  out[2] = -k * rz;
  if (env.coriolisLatitudeDeg !== null) {
    const lat = (env.coriolisLatitudeDeg * Math.PI) / 180;
    // Earth rotation in (x east, y up, z south): (0, w sin(lat), -w cos(lat)). a = -2 (Omega x v).
    const ox = 0;
    const oy = EARTH_OMEGA * Math.sin(lat);
    const oz = -EARTH_OMEGA * Math.cos(lat);
    out[0] += -2 * (oy * vz - oz * vy);
    out[1] += -2 * (oz * vx - ox * vz);
    out[2] += -2 * (ox * vy - oy * vx);
  }
  void s;
}

/** Advance one step with the midpoint method. Mutates `s`. */
// Scratch space for the integrator: it runs millions of steps, so it allocates nothing.
const A1: [number, number, number] = [0, 0, 0];
const A2: [number, number, number] = [0, 0, 0];

export function stepShell(s: ShellState, spec: ShellSpec, env: Environment, dt: number): void {
  const area = (Math.PI * spec.diameterM * spec.diameterM) / 4;
  const a1 = A1;
  const a2 = A2;
  acceleration(s, s.vx, s.vy, s.vz, s.y, spec, env, area, a1);
  const mvx = s.vx + a1[0] * dt * 0.5;
  const mvy = s.vy + a1[1] * dt * 0.5;
  const mvz = s.vz + a1[2] * dt * 0.5;
  const my = s.y + s.vy * dt * 0.5;
  acceleration(s, mvx, mvy, mvz, my, spec, env, area, a2);
  s.x += mvx * dt;
  s.y += mvy * dt;
  s.z += mvz * dt;
  s.vx += a2[0] * dt;
  s.vy += a2[1] * dt;
  s.vz += a2[2] * dt;
  s.t += dt;
}

export interface Impact {
  x: number;
  z: number;
  /** Time of flight, s. */
  tof: number;
  /** Speed at impact, m/s, and angle below the horizontal, degrees. */
  speed: number;
  angleDeg: number;
  /** Highest point reached, m. */
  apex: number;
}

/**
 * Fly a shell until it comes down through `level` metres above the sea (0 is the sea itself; a hilltop fort is higher).
 * Returns null if it never comes down within `maxTime`.
 */
export function flyToSea(
  initial: ShellState,
  spec: ShellSpec,
  env: Environment,
  dt = 0.05,
  maxTime = 200,
  level = 0,
): Impact | null {
  const s: ShellState = { ...initial };
  let apex = s.y;
  while (s.t < maxTime) {
    const px = s.x;
    const py = s.y;
    const pz = s.z;
    const pt = s.t;
    stepShell(s, spec, env, dt);
    apex = Math.max(apex, s.y);
    if (s.y <= level && py > level) {
      // Interpolate the crossing within the step.
      const f = (py - level) / (py - s.y);
      return {
        x: px + (s.x - px) * f,
        z: pz + (s.z - pz) * f,
        tof: pt + dt * f,
        speed: Math.hypot(s.vx, s.vy, s.vz),
        angleDeg: (Math.atan2(-s.vy, Math.hypot(s.vx, s.vz)) * 180) / Math.PI,
        apex,
      };
    }
  }
  return null;
}

/**
 * Horizontal range and flight time at a given elevation from a muzzle `height` above the sea, still air. `level` is the
 * height of the ground it comes down on (a target on a hill); a shell that never climbs that high returns null.
 */
export function rangeAtElevation(
  spec: ShellSpec,
  elevation: number,
  muzzleHeight = 12,
  env: Environment = CALM,
  level = 0,
): { range: number; tof: number; angleDeg: number; speed: number } | null {
  const impact = flyToSea(launch(spec, [0, muzzleHeight, 0], 0, elevation), spec, env, 0.05, 200, level);
  if (!impact) return null;
  return { range: Math.hypot(impact.x, impact.z), tof: impact.tof, angleDeg: impact.angleDeg, speed: impact.speed };
}

/**
 * Elevation (radians) that lands a shell at `range` metres in still air, low-angle solution, by bisection.
 * Returns null when the range is beyond what `maxElevation` can reach.
 */
export function solveElevation(
  spec: ShellSpec,
  range: number,
  maxElevation: number,
  muzzleHeight = 12,
  env: Environment = CALM,
  level = 0,
): number | null {
  const reach = rangeAtElevation(spec, maxElevation, muzzleHeight, env, level);
  if (!reach || reach.range < range) return null;
  let lo = 0;
  let hi = maxElevation;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    // A shell too flat to climb to the ground's height falls short whatever the range: treat it as range zero.
    const r = rangeAtElevation(spec, mid, muzzleHeight, env, level);
    if (!r || r.range < range) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
