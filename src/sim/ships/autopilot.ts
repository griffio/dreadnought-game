import type { ShipDynamics } from './dynamics';

const TWO_PI = Math.PI * 2;

/** Signed difference to - from, wrapped to (-pi, pi]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/** The fastest turn the autopilot asks for, rad/s (a little under what the rudder can give at cruising speed). */
const MAX_YAW_DEMAND = 0.03;
/** Seconds over which it tries to close a course error. */
const CLOSE_SECONDS = 20;

/**
 * Rudder order (-1..1) that steers a ship toward a compass course: ask for a yaw rate that would close the error in
 * about twenty seconds, then the rudder that gives that yaw rate at the present speed.
 */
export function rudderForCourse(d: ShipDynamics, courseRad: number): number {
  const err = angleDelta(d.heading, courseRad);
  const yawWanted = Math.min(Math.max(err / CLOSE_SECONDS, -MAX_YAW_DEMAND), MAX_YAW_DEMAND);
  const perRudder = (Math.max(Math.abs(d.speed), 2) / (d.handling.turnRadiusLengths * d.handling.lengthM)) * Math.sign(d.speed || 1);
  return Math.min(Math.max(yawWanted / perRudder, -1), 1);
}
