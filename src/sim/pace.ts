import type { AiProfile } from './combat/ai';
import type { ShipSetup } from './combat/setup';
import { REAL_PLOT, type PlotTiming } from './gunnery/gunnery';
import type { GunSpec } from './gunnery/guns';
import { handlingFor } from './ships/dynamics';

/**
 * How fast the world runs. The real pace is the game as designed: a heavy ship that takes a minute to gather way, shells that
 * take half a minute to land, a plot that takes a minute to settle. Arcade is the same sim with the clocks wound on: faster
 * hulls that turn on a sixpence, quicker guns and a table that finds the range in a few readings. It is a transform of a ship's
 * setup (and of the sort of fight the scenario picks), so everything downstream (the player's ship, the enemy's, the AI, the
 * HUD) runs unchanged on the faster numbers.
 */
export type PaceId = 'real' | 'arcade';

export interface Pace {
  id: PaceId;
  name: string;
  /** What it is like to play, a line for the front door. */
  blurb: string;
  /** Top speed, times the ship's own. */
  speed: number;
  /** The engines gather and shed way this many times as fast. */
  engines: number;
  /** The steering gear swings the rudder this many times as fast. */
  rudder: number;
  /** The turning circle is this many times tighter (and the yaw settles this many times faster). */
  turning: number;
  /** Guns reload this many times as fast; turrets train and elevate this many times as fast. */
  reload: number;
  slew: number;
  /** Torpedoes run this many times as fast, and the tubes reload this many times as fast. */
  torpedoes: number;
  /** The ranges captains choose to fight at, times the real ones: the guns still reach as far, but the fight is brought in close. */
  engagement: number;
  /** Rangefinder error, times the ship's own (the crews are better drilled). */
  rangefinderError: number;
  /** The plotting table's own timing. */
  plot: PlotTiming;
  /** The time that earns the Admiralty's bonus for a quick finish, times the sortie's own par: a quicker game has a shorter one. */
  parScale: number;
}

export const REAL: Pace = {
  id: 'real',
  name: 'Realistic',
  blurb: 'Heavy ships that take a minute to gather way, shells half a minute in the air, a plot that takes a minute to settle. A fight lasts a quarter of an hour.',
  speed: 1,
  engines: 1,
  rudder: 1,
  turning: 1,
  reload: 1,
  slew: 1,
  torpedoes: 1,
  engagement: 1,
  rangefinderError: 1,
  plot: REAL_PLOT,
  parScale: 1,
};

export const ARCADE: Pace = {
  id: 'arcade',
  name: 'Arcade',
  blurb: 'Ships half as fast again and about three times as quick to turn, guns that reload in half the time, a plot that settles in twenty seconds. A fight lasts a few minutes.',
  speed: 1.5,
  engines: 2.5,
  rudder: 2.5,
  turning: 2,
  reload: 2,
  slew: 2.5,
  torpedoes: 1.5,
  engagement: 0.8,
  rangefinderError: 0.7,
  // A reading every two thirds of a second, a plot that remembers forty, and the confidence to call a course after a dozen.
  plot: { rangingPeriod: 0.667, window: 40, tau: 16, positionSigma: 20, minSpan: 2.4 },
  parScale: 0.45,
};

export const PACES: Record<PaceId, Pace> = { real: REAL, arcade: ARCADE };

export function isPaceId(v: string | null | undefined): v is PaceId {
  return v === 'real' || v === 'arcade';
}

export function paceById(id: string | null | undefined): Pace {
  return isPaceId(id) ? PACES[id] : REAL;
}

/** A gun at the given pace: it reloads and swings round faster. The gun in the data file is left as it is. */
export function pacedGun(gun: GunSpec, pace: Pace): GunSpec {
  if (pace === REAL) return gun;
  return {
    ...gun,
    reloadSeconds: gun.reloadSeconds / pace.reload,
    trainRateDegPerSec: gun.trainRateDegPerSec * pace.slew,
    elevationRateDegPerSec: gun.elevationRateDegPerSec * pace.slew,
  };
}

/** A ship's setup at the given pace: the same ship, with her speed, handling, guns, tubes and plotting table wound on. */
export function pacedSetup(setup: ShipSetup, pace: Pace): ShipSetup {
  if (pace === REAL) return setup;
  const h = handlingFor(setup.ship.hull.length, setup.maxSpeedKn, setup.handling);
  return {
    ...setup,
    maxSpeedKn: setup.maxSpeedKn * pace.speed,
    handling: {
      ...setup.handling,
      accelSeconds: h.accelSeconds / pace.engines,
      decelSeconds: h.decelSeconds / pace.engines,
      brakeSeconds: h.brakeSeconds / pace.engines,
      rudderRateDegPerSec: h.rudderRateDegPerSec * pace.rudder,
      turnRadiusLengths: h.turnRadiusLengths / pace.turning,
      yawResponseSeconds: h.yawResponseSeconds / pace.turning,
    },
    batteries: setup.batteries.map((b) => ({ ...b, gun: pacedGun(b.gun, pace) })),
    rangefinder: {
      ...setup.rangefinder,
      angularError: setup.rangefinder.angularError * pace.rangefinderError,
      biasFraction: setup.rangefinder.biasFraction * pace.rangefinderError,
    },
    tubes: setup.tubes?.map((t) => ({
      ...t,
      trainRateDegPerSec: t.trainRateDegPerSec * pace.slew,
      reloadSeconds: t.reloadSeconds / pace.torpedoes,
    })),
    torpedo: setup.torpedo && {
      ...setup.torpedo,
      settings: setup.torpedo.settings.map((s) => ({ ...s, speed: s.speed * pace.torpedoes })),
    },
    plot: pace.plot,
  };
}

/** How a captain fights at the given pace: the same temper, closer in, and quicker to jink and to decide. */
export function pacedProfile(profile: AiProfile, pace: Pace): AiProfile {
  if (pace === REAL) return profile;
  return {
    ...profile,
    rangeMin: profile.rangeMin * pace.engagement,
    rangeMax: profile.rangeMax * pace.engagement,
    jinkPeriod: profile.jinkPeriod / pace.turning,
    thinkPeriod: profile.thinkPeriod / pace.turning,
  };
}
