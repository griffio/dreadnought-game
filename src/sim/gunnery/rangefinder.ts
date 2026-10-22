import type { Rng } from '../rng';

/**
 * A coincidence rangefinder: the error of a single reading grows with the square of the range and shrinks with the
 * length of its optical base, so a longer instrument reaches farther. Haze makes it worse.
 */
export interface RangefinderSpec {
  /** Optical base, metres. */
  baseM: number;
  /** Angular reading error in radians (about half an arc-second for a good operator, spread over a crew's habits). */
  angularError: number;
  /**
   * One-sigma systematic error as a fraction of range: calibration and operator habit. It is the same for every reading
   * of an engagement, so averaging a long plot cannot remove it. Only the fall of shot can.
   */
  biasFraction: number;
}

export const RANGEFINDER_9FT: RangefinderSpec = { baseM: 2.74, angularError: 2.5e-6, biasFraction: 0.008 };
/** A torpedo boat's little 3-foot instrument. */
export const RANGEFINDER_3FT: RangefinderSpec = { baseM: 0.9, angularError: 3e-6, biasFraction: 0.012 };
export const RANGEFINDER_15FT: RangefinderSpec = { baseM: 4.57, angularError: 2.5e-6, biasFraction: 0.006 };
/** The thirty-foot instrument of the later battleships, with a better-trained crew behind it. */
export const RANGEFINDER_30FT: RangefinderSpec = { baseM: 9.14, angularError: 2.2e-6, biasFraction: 0.004 };

/** One-sigma error of a single reading, metres. */
export function rangefinderSigma(range: number, spec: RangefinderSpec, visibilityKm = 40): number {
  const haze = Math.max(1, 30 / Math.max(visibilityKm, 1));
  return ((range * range * spec.angularError) / spec.baseM) * haze;
}

/** Draw the engagement's systematic error once, as a fraction of range. */
export function newRangefinderBias(rng: Rng, spec: RangefinderSpec): number {
  return rng.gaussian() * spec.biasFraction;
}

/** `bias` is the engagement's fractional systematic error from `newRangefinderBias`. */
export function measureRange(rng: Rng, trueRange: number, spec: RangefinderSpec, visibilityKm = 40, bias = 0): number {
  return trueRange * (1 + bias) + rng.gaussian() * rangefinderSigma(trueRange, spec, visibilityKm);
}
