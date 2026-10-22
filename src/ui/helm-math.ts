/**
 * Pure geometry for the touch helm widgets, kept free of the DOM so it can be tested.
 */
import { TELEGRAPH_MAX, TELEGRAPH_MIN } from '../sim/ships/dynamics';

/** Wheel turns from hard port to hard starboard. 0.75 turn each way is comfortable under a thumb. */
export const WHEEL_TURNS_TO_LOCK = 0.75;

/** Smallest signed difference between two angles, in (-pi, pi]. */
export function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rudder order (-1..1) for a wheel rotated `angle` radians from amidships. */
export function rudderFromWheel(angle: number): number {
  return Math.min(Math.max(angle / (Math.PI * 2 * WHEEL_TURNS_TO_LOCK), -1), 1);
}

/** Wheel angle (radians) for a rudder order. */
export function wheelFromRudder(order: number): number {
  return order * Math.PI * 2 * WHEEL_TURNS_TO_LOCK;
}

export const TELEGRAPH_POSITIONS = TELEGRAPH_MAX - TELEGRAPH_MIN + 1;

/** Telegraph position for a vertical pointer position along the lever track (0 = top = FLANK). */
export function telegraphFromTrack(y: number, top: number, height: number): number {
  const f = Math.min(Math.max((y - top) / height, 0), 1);
  const index = Math.round(f * (TELEGRAPH_POSITIONS - 1)); // 0 at the top
  return TELEGRAPH_MAX - index;
}

/** Fraction down the track (0..1) of a telegraph position, for placing the handle. */
export function trackFromTelegraph(position: number): number {
  return (TELEGRAPH_MAX - position) / (TELEGRAPH_POSITIONS - 1);
}
