/**
 * The torpedo and the tubes that fire it. Speeds are in metres per second, distances in metres, angles in degrees unless a
 * name says radians. The figures are those of a 1900s-1910s 18-inch Whitehead: quick and short-legged on one setting, slow and
 * long-legged on the other.
 */
export interface SpeedSetting {
  name: string;
  speed: number;
  /** How far it runs before the motor stops and it sinks, metres. */
  range: number;
}

export interface TorpedoSpec {
  id: string;
  label: string;
  diameterM: number;
  /** Bursting charge, kg of explosive (gun-cotton equivalent). */
  warheadKg: number;
  settings: readonly SpeedSetting[];
  /** The pistol is not armed until it has run this far, so it is safe at the tube, metres. */
  armingDistance: number;
  /** Running depth range the crew can set, metres. */
  depthMin: number;
  depthMax: number;
  /** Chance a torpedo runs true. The rest run too deep or sink soon after launch. */
  reliability: number;
}

export const TORPEDO_18_INCH: TorpedoSpec = {
  id: '18-inch',
  label: '18" torpedo',
  diameterM: 0.457,
  warheadKg: 95,
  settings: [
    { name: 'FAST', speed: 17.5, range: 4200 },
    { name: 'SLOW', speed: 12.6, range: 8500 },
  ],
  armingDistance: 110,
  depthMin: 2,
  depthMax: 6,
  reliability: 0.9,
};

/** A torpedo tube: where it is, which way it can fire, how fast it can be trained and how long a reload takes. */
export interface TubeSpec {
  id: string;
  /** Position in ship space, metres (x forward from amidships, z to starboard). */
  x: number;
  z: number;
  /**
   * The bearings it can fire on, degrees clockwise from the bow, as one contiguous range (as for a turret). A fixed beam tube
   * has a narrow arc around its axis (the angle the torpedo's gyroscope can turn it through); a deck mounting trains.
   */
  arcDeg: readonly [number, number];
  /** Degrees per second the mounting turns; 0 for a fixed tube. */
  trainRateDegPerSec: number;
  reloadSeconds: number;
  /** Torpedoes carried for this tube, the one in it included. */
  rounds: number;
  /** Where it rests, degrees from the bow. */
  restBearingDeg: number;
}

export interface TorpedoLaunchDefaults {
  settingIndex: number;
  depth: number;
}

/** The 21-inch Mark II of the Queen Elizabeths' submerged tubes: faster and heavier than the 18-inch. */
export const TORPEDO_21_INCH: TorpedoSpec = {
  id: '21-inch',
  label: '21" torpedo',
  diameterM: 0.533,
  warheadKg: 170,
  settings: [
    { name: 'FAST', speed: 18.0, range: 5000 },
    { name: 'SLOW', speed: 13.5, range: 9500 },
  ],
  armingDistance: 120,
  depthMin: 2,
  depthMax: 7,
  reliability: 0.92,
};

/** The 24.5-inch of the Nelsons' two bow tubes: the biggest torpedo a British ship ever carried. */
export const TORPEDO_24_5_INCH: TorpedoSpec = {
  id: '24.5-inch',
  label: '24.5" torpedo',
  diameterM: 0.622,
  warheadKg: 340,
  settings: [
    { name: 'FAST', speed: 18.5, range: 6000 },
    { name: 'SLOW', speed: 14.0, range: 11000 },
  ],
  armingDistance: 140,
  depthMin: 3,
  depthMax: 8,
  reliability: 0.9,
};
