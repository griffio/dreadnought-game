import { CALM, flyToSea, launch, rangeAtElevation, solveElevation, type Environment, type ShellSpec } from './ballistics';

/**
 * Firing solution: where to point the guns so that shells arrive where the target will be.
 *
 * The solver uses the real ballistic integrator and a 2D Newton iteration on (azimuth, elevation) so it accounts for
 * drag, the ship's own motion carrying the shell, and the target's predicted position at the moment of impact (its
 * flight time depends on the answer, so that is iterated too). The environment it assumes is its own *belief*: wind
 * it does not know about is exactly the systematic error that spotting corrections exist to remove.
 */
export interface OwnState {
  x: number;
  z: number;
  /** Ship velocity, m/s: the shell inherits it. */
  vx: number;
  vz: number;
  muzzleHeight: number;
}

export interface TargetState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Height of the ground she stands on above the sea, metres (a fort on a hill); 0 for a ship. */
  y?: number;
}

/** Spotting corrections in metres: range is + beyond the target (over), deflection is + to the right of the line of fire. */
export interface Corrections {
  range: number;
  deflection: number;
}

export interface FireSolution {
  /** Compass azimuth and elevation to fire at, radians. */
  azimuth: number;
  elevation: number;
  /** Predicted flight time, s. */
  tof: number;
  /** Where the shells are meant to land (world) and the horizontal distance to it. */
  aimX: number;
  aimZ: number;
  range: number;
  /** False when the aim point is beyond what the guns can elevate to. */
  valid: boolean;
  iterations: number;
}

export interface WarmStart {
  azimuth: number;
  elevation: number;
  tof: number;
}

const SOLVER_DT = 0.1;

export function azimuthTo(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** Impact point relative to the launch point for a given aim, or null if the shell never lands. */
function impactFor(
  spec: ShellSpec,
  own: OwnState,
  az: number,
  el: number,
  env: Environment,
  level = 0,
): { x: number; z: number; tof: number } | null {
  const s = launch(spec, [0, own.muzzleHeight, 0], az, el, [own.vx, own.vz]);
  const hit = flyToSea(s, spec, env, SOLVER_DT, 200, level);
  return hit ? { x: hit.x, z: hit.z, tof: hit.tof } : null;
}

/** Is a solution plausible: pointing roughly at the target, at a sane elevation, with a sane flight time? */
function sane(s: FireSolution, bearing0: number): boolean {
  let dAz = s.azimuth - bearing0;
  dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
  return Number.isFinite(s.azimuth) && Number.isFinite(s.elevation) && Math.abs(dAz) < 0.5 && s.elevation > -0.3 && s.elevation < 1.2 && s.tof < 150;
}

export interface SolveOptions {
  /** Take the plunging trajectory (a howitzer, firing over a ridge) rather than the flat one. */
  highAngle?: boolean;
}

export function solveFiring(
  own: OwnState,
  target: TargetState,
  spec: ShellSpec,
  maxElevation: number,
  corrections: Corrections = { range: 0, deflection: 0 },
  assumed: Environment = CALM,
  warm?: WarmStart,
  options: SolveOptions = {},
): FireSolution {
  const bearing0 = azimuthTo(target.x - own.x, target.z - own.z);
  const first = solve(own, target, spec, maxElevation, corrections, assumed, warm, options);
  if (sane(first, bearing0)) return first;
  // The iteration ran away (a bad warm start or an absurd target velocity): start again cold and without any lead.
  const still = solve(own, { ...target, vx: 0, vz: 0 }, spec, maxElevation, corrections, assumed, undefined, options);
  return still;
}

function solve(
  own: OwnState,
  target: TargetState,
  spec: ShellSpec,
  maxElevation: number,
  corrections: Corrections,
  assumed: Environment,
  warm?: WarmStart,
  options: SolveOptions = {},
): FireSolution {
  const bearing0 = azimuthTo(target.x - own.x, target.z - own.z);
  const range0 = Math.hypot(target.x - own.x, target.z - own.z);
  const level = target.y ?? 0;
  let az = warm?.azimuth ?? bearing0;
  // A plunging shot starts from a steep elevation, so that the iteration settles on that branch and not the flat one.
  let el =
    warm?.elevation ??
    (options.highAngle
      ? Math.min(Math.max(maxElevation * 0.85, 0.9), maxElevation)
      : (solveElevation(spec, range0, maxElevation * 1.6, own.muzzleHeight, assumed, level) ?? maxElevation));
  let tof = warm?.tof ?? range0 / (spec.muzzleVelocity * 0.75);

  let aimX = target.x;
  let aimZ = target.z;
  let iterations = 0;
  for (; iterations < 8; iterations++) {
    // Where the target will be when the shells arrive, with the spotting corrections applied along and across the line of fire.
    aimX = target.x + target.vx * tof;
    aimZ = target.z + target.vz * tof;
    const rx = aimX - own.x;
    const rz = aimZ - own.z;
    const r = Math.hypot(rx, rz) || 1;
    const ux = rx / r;
    const uz = rz / r;
    aimX += ux * corrections.range - uz * corrections.deflection;
    aimZ += uz * corrections.range + ux * corrections.deflection;
    const wantX = aimX - own.x;
    const wantZ = aimZ - own.z;

    // Newton on (azimuth, elevation) so that the impact point lands on the aim point.
    let impact = impactFor(spec, own, az, el, assumed, level);
    if (!impact) break;
    for (let k = 0; k < 4; k++) {
      const ex = wantX - impact.x;
      const ez = wantZ - impact.z;
      if (Math.hypot(ex, ez) < 1.5) break;
      const da = 4e-4;
      const de = 4e-4;
      const ia = impactFor(spec, own, az + da, el, assumed, level);
      const ie = impactFor(spec, own, az, el + de, assumed, level);
      if (!ia || !ie) break;
      const j00 = (ia.x - impact.x) / da;
      const j10 = (ia.z - impact.z) / da;
      const j01 = (ie.x - impact.x) / de;
      const j11 = (ie.z - impact.z) / de;
      const det = j00 * j11 - j01 * j10;
      if (Math.abs(det) < 1e-9) break;
      // Steps are limited: near the gun's maximum range the Jacobian goes flat and an unchecked step flies off.
      az += Math.min(Math.max((j11 * ex - j01 * ez) / det, -0.05), 0.05);
      el += Math.min(Math.max((-j10 * ex + j00 * ez) / det, -0.05), 0.05);
      const next = impactFor(spec, own, az, el, assumed, level);
      if (!next) break;
      impact = next;
    }
    const settled = Math.abs(impact.tof - tof) < 0.03;
    tof = impact.tof;
    if (settled) {
      iterations++;
      break;
    }
  }

  const range = Math.hypot(aimX - own.x, aimZ - own.z);
  const valid = el <= maxElevation + 1e-4 && Number.isFinite(az) && Number.isFinite(el);
  return { azimuth: az, elevation: Math.min(el, maxElevation), tof, aimX, aimZ, range, valid, iterations };
}

/** The steepest and the flattest elevations a plunging shot is laid at, radians, and the one it is aimed to be near. */
export const PLUNGE_MAX = (65 * Math.PI) / 180;
export const PLUNGE_MIN = (45 * Math.PI) / 180;
const PLUNGE_BEST = (58 * Math.PI) / 180;

interface ChargeRow {
  scaled: ShellSpec;
  /** Range at the steepest, flattest and preferred plunging elevations. */
  r65: number;
  r45: number;
  r58: number;
}
const chargeTables = new WeakMap<ShellSpec, Map<number, ChargeRow[]>>();

function chargeTable(shell: ShellSpec, charges: readonly number[], muzzleHeight: number): ChargeRow[] {
  let byHeight = chargeTables.get(shell);
  if (!byHeight) chargeTables.set(shell, (byHeight = new Map()));
  const key = Math.round(muzzleHeight);
  let rows = byHeight.get(key);
  if (!rows) {
    rows = charges.map((c) => {
      const scaled = c === 1 ? shell : { ...shell, muzzleVelocity: shell.muzzleVelocity * c };
      const at = (el: number) => rangeAtElevation(scaled, el, muzzleHeight, CALM)?.range ?? 0;
      return { scaled, r65: at(PLUNGE_MAX), r45: at(PLUNGE_MIN), r58: at(PLUNGE_BEST) };
    });
    byHeight.set(key, rows);
  }
  return rows;
}

/**
 * The charge that brings a howitzer's shell down at `range` metres on a steep trajectory: of the charges that can reach it
 * between 45 and 65 degrees of elevation, the one that lays it nearest 58. Returns the shell as fired with that charge (the
 * nearest to it when the range is beyond them all). Still air is assumed: wind is for the spotter to correct.
 */
export function chargeFor(shell: ShellSpec, charges: readonly number[], range: number, muzzleHeight: number): ShellSpec {
  const rows = chargeTable(shell, charges, muzzleHeight);
  let best: ChargeRow | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    if (range < r.r65 || range > r.r45) continue;
    const score = Math.abs(r.r58 - range);
    if (score < bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (best) return best.scaled;
  // Out of every band: the smallest charge that carries that far, or the full charge when none does.
  return rows.find((r) => r.r45 >= range)?.scaled ?? rows[rows.length - 1]!.scaled;
}
