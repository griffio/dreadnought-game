/**
 * Ship manoeuvring: surge and yaw, driven by an engine-order telegraph and a rate-limited rudder.
 *
 * Deliberately simple and tuned to feel like a heavy ship: it builds speed over a minute, coasts for minutes,
 * turns in a circle of about three hull lengths, loses speed in a hard turn, and has no steering at all
 * without way on or engine wash over the rudder. All distances are metres, angles radians, speeds m/s.
 *
 * Heading is compass: 0 = north = -z, 90 degrees = east = +x. Positive rudder turns to starboard.
 */
export const KNOT = 0.514444;

/** Engine-order telegraph positions, stern to bow. */
export const TELEGRAPH = {
  FULL_ASTERN: -3,
  HALF_ASTERN: -2,
  SLOW_ASTERN: -1,
  STOP: 0,
  SLOW_AHEAD: 1,
  HALF_AHEAD: 2,
  FULL_AHEAD: 3,
  FLANK: 4,
} as const;
export const TELEGRAPH_MIN = -3;
export const TELEGRAPH_MAX = 4;

export const TELEGRAPH_LABELS: Record<number, string> = {
  [-3]: 'FULL ASTERN',
  [-2]: 'HALF ASTERN',
  [-1]: 'SLOW ASTERN',
  [0]: 'STOP',
  [1]: 'SLOW AHEAD',
  [2]: 'HALF AHEAD',
  [3]: 'FULL AHEAD',
  [4]: 'FLANK',
};

export interface ShipHandling {
  lengthM: number;
  /** Speed at FLANK, knots. */
  maxSpeedKn: number;
  /** Fraction of max speed commanded by each telegraph position, index = position - TELEGRAPH_MIN. */
  telegraphFraction: readonly number[];
  /** Seconds to close 63% of the gap when speeding up / slowing down / reversing the engines. */
  accelSeconds: number;
  decelSeconds: number;
  brakeSeconds: number;
  /** Hard-over rudder, degrees, and how fast the steering gear moves it, degrees per second. */
  rudderMaxDeg: number;
  rudderRateDegPerSec: number;
  /** Steady turn radius at hard-over rudder, in hull lengths. */
  turnRadiusLengths: number;
  /** Seconds for the yaw rate to settle toward its steady value. */
  yawResponseSeconds: number;
  /** Fraction of speed lost in a sustained hard-over turn. */
  turnSpeedLoss: number;
}

/** What one class does differently from the reference battleship: any of the handling figures except length and top speed. */
export type HandlingOverrides = Partial<Omit<ShipHandling, 'lengthM' | 'maxSpeedKn'>>;

/** A ship's handling: the reference battleship's, with her class's differences laid over it. */
export function handlingFor(lengthM: number, maxSpeedKn: number, overrides?: HandlingOverrides): ShipHandling {
  return { ...battleshipHandling(lengthM, maxSpeedKn), ...overrides };
}

/** The reference ship is HMS Dreadnought: a steady turn on hard rudder is a circle of 1.45 lengths' radius. */
export function battleshipHandling(lengthM: number, maxSpeedKn: number): ShipHandling {
  return {
    lengthM,
    maxSpeedKn,
    telegraphFraction: [-0.42, -0.3, -0.16, 0, 0.28, 0.52, 0.8, 1.0],
    accelSeconds: 42,
    decelSeconds: 95,
    brakeSeconds: 48,
    rudderMaxDeg: 35,
    rudderRateDegPerSec: 2.3,
    turnRadiusLengths: 1.45,
    yawResponseSeconds: 6.5,
    turnSpeedLoss: 0.3,
  };
}

export class ShipDynamics {
  /** World position, metres. */
  x = 0;
  z = 0;
  /** Compass heading, radians. */
  heading = 0;
  /** Speed through the water along the ship, m/s; negative is astern. */
  speed = 0;
  /** Turn rate, rad/s, positive to starboard. */
  yawRate = 0;
  /** Rudder actually applied and rudder ordered, both -1 (hard port) to 1 (hard starboard). */
  rudder = 0;
  rudderOrder = 0;
  telegraph = 0;
  /** What the machinery can still deliver, 0..1: damage to boilers and engines scales the speed an order gives. */
  powerFactor = 1;
  /** When set, the steering gear has failed and the rudder is held at this angle (-1..1) whatever is ordered. */
  rudderJam: number | null = null;

  constructor(readonly handling: ShipHandling) {}

  get speedKnots(): number {
    return this.speed / KNOT;
  }

  get headingDeg(): number {
    return ((((this.heading * 180) / Math.PI) % 360) + 360) % 360;
  }

  /** Rudder in degrees from midships (positive starboard). */
  get rudderDeg(): number {
    return this.rudder * this.handling.rudderMaxDeg;
  }

  setTelegraph(position: number): void {
    this.telegraph = Math.min(Math.max(Math.round(position), TELEGRAPH_MIN), TELEGRAPH_MAX);
  }

  stepTelegraph(delta: number): void {
    this.setTelegraph(this.telegraph + delta);
  }

  setRudderOrder(order: number): void {
    this.rudderOrder = Math.min(Math.max(order, -1), 1);
  }

  /** Speed the current telegraph order would settle at, ignoring turning losses, m/s. */
  get orderedSpeed(): number {
    const h = this.handling;
    return h.telegraphFraction[this.telegraph - TELEGRAPH_MIN]! * h.maxSpeedKn * KNOT * this.powerFactor;
  }

  step(dt: number): void {
    const h = this.handling;

    // Steering gear: the rudder moves toward the order at a limited rate.
    const rate = (h.rudderRateDegPerSec / h.rudderMaxDeg) * dt;
    if (this.rudderJam !== null) this.rudder = this.rudderJam;
    else this.rudder += Math.min(Math.max(this.rudderOrder - this.rudder, -rate), rate);

    // Engines: first-order lag toward the ordered speed, slower to shed way than to build it.
    // A hard rudder drags the ship down in proportion to its square.
    const ordered = this.orderedSpeed;
    const target = ordered * (1 - h.turnSpeedLoss * this.rudder * this.rudder);
    let seconds = h.accelSeconds;
    if (target < this.speed) seconds = ordered < 0 ? h.brakeSeconds : h.decelSeconds;
    this.speed += ((target - this.speed) / seconds) * dt;

    // Yaw: a rudder only steers with water flowing over it, from way on or from the propeller wash.
    const wash = Math.abs(ordered) / (h.maxSpeedKn * KNOT);
    const authority = Math.min(Math.max(Math.abs(this.speed) / 3, wash * 0.3), 1);
    const radius = h.turnRadiusLengths * h.lengthM;
    const steady = (this.speed / radius) * this.rudder * authority;
    this.yawRate += ((steady - this.yawRate) / h.yawResponseSeconds) * dt;
    this.heading += this.yawRate * dt;

    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += -Math.cos(this.heading) * this.speed * dt;
  }

  /** Outward heel (radians, positive = starboard down) the ship leans in a turn. Port turn leans to starboard. */
  get turnHeel(): number {
    // Centripetal acceleration over g, scaled by how high the centre of gravity sits over the metacentre.
    return -(this.speed * this.yawRate * 1.6) / 9.81;
  }
}
