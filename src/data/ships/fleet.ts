import type { ShipSetup } from '../../sim/combat/setup';
import {
  GUN_12_45_MK_X,
  GUN_12_PDR,
  GUN_14_45_MK_VII,
  GUN_15_42_MK_I,
  GUN_15_45_SK,
  GUN_15_55_SK_C28,
  GUN_16_45_MK_I,
  GUN_17_40_SK,
  GUN_28_40_SK,
  GUN_30_50_SK,
  GUN_38_SK_C34,
  GUN_5_25_DP,
  GUN_6_45,
  GUN_6_50,
  GUN_88_SK,
} from '../../sim/gunnery/guns';
import { RANGEFINDER_15FT, RANGEFINDER_30FT, RANGEFINDER_3FT, RANGEFINDER_9FT } from '../../sim/gunnery/rangefinder';
import { TORPEDO_18_INCH, TORPEDO_21_INCH, TORPEDO_24_5_INCH, type TubeSpec } from '../../sim/torpedo/spec';
import { DESTROYER } from './destroyer';
import { DESTROYER_DAMAGE } from './destroyer-damage';
import { DREADNOUGHT } from './dreadnought';
import { DREADNOUGHT_DAMAGE } from './dreadnought-damage';
import { BISMARCK } from './bismarck';
import { BISMARCK_DAMAGE } from './bismarck-damage';
import { KAISER } from './kaiser';
import { KAISER_DAMAGE } from './kaiser-damage';
import { KING_GEORGE_V } from './king-george-v';
import { KING_GEORGE_V_DAMAGE } from './king-george-v-damage';
import { beamTube, sideIds } from './kit';
import { NELSON } from './nelson';
import { NELSON_DAMAGE } from './nelson-damage';
import { QUEEN_ELIZABETH } from './queen-elizabeth';
import { QUEEN_ELIZABETH_DAMAGE } from './queen-elizabeth-damage';
import { PRE_DREADNOUGHT } from './pre-dreadnought';
import { PRE_DREADNOUGHT_DAMAGE } from './pre-dreadnought-damage';

/** HMS Dreadnought's five submerged 18-inch tubes: two on each beam and one astern. A tube's arc is the angle its gyroscope can turn the torpedo through. */
const submerged = (id: string, x: number, bearing: number): TubeSpec => ({
  id,
  x,
  z: 0,
  arcDeg: [bearing - 18, bearing + 18],
  trainRateDegPerSec: 0,
  reloadSeconds: 150,
  rounds: 2,
  restBearingDeg: bearing,
});

export const DREADNOUGHT_SETUP: ShipSetup = {
  name: 'HMS Dreadnought',
  ship: DREADNOUGHT,
  damage: DREADNOUGHT_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_12_45_MK_X, turretIds: ['A', 'P', 'Q', 'X', 'Y'] },
    { id: 'secondary', gun: GUN_12_PDR, turretIds: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'] },
  ],
  maxSpeedKn: 21,
  rangefinder: RANGEFINDER_9FT,
  tubes: [submerged('TP1', 52, -90), submerged('TP2', 38, -90), submerged('TS1', 52, 90), submerged('TS2', 38, 90), submerged('TA', -76, 180)],
  torpedo: TORPEDO_18_INCH,
  // The 12-pounders choose their own targets, the destroyers, and leave the battleships to the main battery.
  autoTarget: { battery: 'secondary', maxRange: 8500 },
};

export const PRE_DREADNOUGHT_SETUP: ShipSetup = {
  name: 'SMS Hessen',
  ship: PRE_DREADNOUGHT,
  damage: PRE_DREADNOUGHT_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_28_40_SK, turretIds: ['F', 'R'] },
    { id: 'secondary', gun: GUN_17_40_SK, turretIds: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'] },
  ],
  maxSpeedKn: 18,
  // Reciprocating engines: slow to gather way, and a short ship with an old-fashioned rudder.
  handling: { turnRadiusLengths: 1.5, rudderRateDegPerSec: 2.0, accelSeconds: 55, decelSeconds: 90, brakeSeconds: 52, yawResponseSeconds: 5.5 },
  rangefinder: RANGEFINDER_9FT,
  // A good crew for her day, but her instruments are older and her guns more worn.
  skill: { rangefinderError: 1.15, dispersion: 1.2 },
};

/** A German torpedo boat: fast, fragile, and armed with the only weapon on the day that can sink a dreadnought at a stroke. */
export const DESTROYER_SETUP: ShipSetup = {
  name: 'SMS S 144',
  ship: DESTROYER,
  damage: DESTROYER_DAMAGE,
  batteries: [{ id: 'main', gun: GUN_88_SK, turretIds: ['G1', 'G2'] }],
  maxSpeedKn: 28,
  // Quick on the helm and the engines, but at 28 knots a small ship still needs a wide circle: she turns on a short fuse, not a short radius.
  handling: { turnRadiusLengths: 2.6, rudderRateDegPerSec: 5, accelSeconds: 16, decelSeconds: 35, brakeSeconds: 22, yawResponseSeconds: 3, turnSpeedLoss: 0.35 },
  rangefinder: RANGEFINDER_3FT,
  skill: { rangefinderError: 1.2, dispersion: 1.4 },
  tubes: [
    { id: 'T1', x: 5, z: 0, arcDeg: [-150, 150], trainRateDegPerSec: 14, reloadSeconds: 10, rounds: 2, restBearingDeg: 0 },
    { id: 'T2', x: -8, z: 0, arcDeg: [-150, 150], trainRateDegPerSec: 14, reloadSeconds: 10, rounds: 2, restBearingDeg: 0 },
  ],
  torpedo: TORPEDO_18_INCH,
  small: true,
};

/** HMS Queen Elizabeth in 1915: the first fast battleship, with eight 15-inch guns, a casemate battery of 6-inch and four submerged 21-inch tubes. */
export const QUEEN_ELIZABETH_SETUP: ShipSetup = {
  name: 'HMS Queen Elizabeth',
  ship: QUEEN_ELIZABETH,
  damage: QUEEN_ELIZABETH_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_15_42_MK_I, turretIds: ['A', 'B', 'X', 'Y'] },
    { id: 'secondary', gun: GUN_6_45, turretIds: sideIds(6).all },
  ],
  maxSpeedKn: 24,
  // Oil-fired and powerful, so she gathers way quickly; long, so her circle is a little wider than the Dreadnought's.
  handling: { turnRadiusLengths: 1.5, accelSeconds: 40, decelSeconds: 100, yawResponseSeconds: 7 },
  rangefinder: RANGEFINDER_9FT,
  tubes: [beamTube('TP1', 56, -90), beamTube('TP2', 44, -90), beamTube('TS1', 56, 90), beamTube('TS2', 44, 90)],
  torpedo: TORPEDO_21_INCH,
  // The 6-inch guns deal with destroyers, and with a capital ship that comes within their reach.
  autoTarget: { battery: 'secondary', maxRange: 9000, capitalRange: 7000 },
  director: [26, 29, 0],
};

/** HMS Rodney in 1941: nine 16-inch guns all forward, the heaviest armour in the fleet, and two submerged 24.5-inch tubes. */
export const RODNEY_SETUP: ShipSetup = {
  name: 'HMS Rodney',
  ship: NELSON,
  damage: NELSON_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_16_45_MK_I, turretIds: ['A', 'B', 'C'] },
    { id: 'secondary', gun: GUN_6_50, turretIds: sideIds(3).all },
  ],
  maxSpeedKn: 23,
  // Thirty-four thousand tons with her weight forward and under-powered for it: she is slow to answer, slow to build speed and slow to stop.
  handling: { turnRadiusLengths: 1.6, rudderRateDegPerSec: 2.0, accelSeconds: 56, decelSeconds: 115, brakeSeconds: 56, yawResponseSeconds: 8 },
  rangefinder: RANGEFINDER_15FT,
  tubes: [beamTube('TP1', 72, -90, 3), beamTube('TS1', 72, 90, 3)],
  torpedo: TORPEDO_24_5_INCH,
  autoTarget: { battery: 'secondary', maxRange: 10000, capitalRange: 8500 },
  director: [18, 29, 0],
};

/** HMS King George V in 1941: ten 14-inch guns, radar ranging, a dual-purpose secondary battery, and quadruple turrets that jam. */
export const KING_GEORGE_V_SETUP: ShipSetup = {
  name: 'HMS King George V',
  ship: KING_GEORGE_V,
  damage: KING_GEORGE_V_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_14_45_MK_VII, turretIds: ['A', 'B', 'Y'] },
    { id: 'secondary', gun: GUN_5_25_DP, turretIds: sideIds(4).all },
  ],
  maxSpeedKn: 28,
  // A modern ship with power to spare and a large rudder: she is the handiest of the British ships.
  handling: { turnRadiusLengths: 1.4, rudderRateDegPerSec: 2.6, accelSeconds: 38, decelSeconds: 105, brakeSeconds: 50, yawResponseSeconds: 7, turnSpeedLoss: 0.28 },
  // The Type 284 radar gives the ranges that a 30-foot optical instrument would.
  rangefinder: RANGEFINDER_30FT,
  autoTarget: { battery: 'secondary', maxRange: 12000, capitalRange: 11000 },
  jams: { turretIds: ['A', 'Y'], chance: 0.035, seconds: 70 },
  director: [37, 31, 0],
};

/** SMS Kaiser in 1914: ten 30.5 cm guns on a flat trajectory, a casemate battery of 15 cm, and a crew that has trained for years. */
export const KAISER_SETUP: ShipSetup = {
  name: 'SMS Kaiser',
  ship: KAISER,
  damage: KAISER_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_30_50_SK, turretIds: ['A', 'P', 'Q', 'X', 'Y'] },
    { id: 'secondary', gun: GUN_15_45_SK, turretIds: sideIds(6).all },
  ],
  maxSpeedKn: 23,
  // Three shafts and a compact hull: a little tighter than the British ships.
  handling: { turnRadiusLengths: 1.4, yawResponseSeconds: 6.2 },
  rangefinder: RANGEFINDER_9FT,
  skill: { rangefinderError: 0.95, dispersion: 1.05 },
  director: [32, 25, 0],
};

/** The battleship Bismarck: the best gunnery of her day, and the best armour. */
export const BISMARCK_SETUP: ShipSetup = {
  name: 'Bismarck',
  ship: BISMARCK,
  damage: BISMARCK_DAMAGE,
  batteries: [
    { id: 'main', gun: GUN_38_SK_C34, turretIds: ['A', 'B', 'X', 'Y'] },
    { id: 'secondary', gun: GUN_15_55_SK_C28, turretIds: sideIds(3).all },
  ],
  maxSpeedKn: 30,
  // Three shafts and twin rudders on a huge hull: she answers well for her size, but she is still a quarter of a mile of ship.
  handling: { turnRadiusLengths: 1.35, rudderRateDegPerSec: 2.8, accelSeconds: 38, decelSeconds: 110, brakeSeconds: 52, yawResponseSeconds: 7.5 },
  rangefinder: RANGEFINDER_30FT,
  skill: { rangefinderError: 0.9, dispersion: 0.9 },
  director: [41, 35, 0],
};

/**
 * Bismarck on the morning of 27 May 1941, after the Swordfish torpedo has jammed her rudder: she can only steam in a circle at
 * the speed she can make against it, with two of her turrets gone, her crew tired, water in the bow and a boiler room, and her
 * fire control shot about. She will not strike her colours.
 */
export const BISMARCK_WOUNDED_SETUP: ShipSetup = {
  ...BISMARCK_SETUP,
  maxSpeedKn: 12,
  wounds: {
    steering: true,
    lostTurrets: ['B', 'Y'],
    flooded: [
      { comp: 'bow', fraction: 0.55, breachM2: 0.35, side: -1 },
      { comp: 'boiler-1', fraction: 0.35, breachM2: 0.2, side: -1 },
    ],
    crew: 0.85,
    fireControl: 0.7,
  },
  rudderJam: -0.35,
  neverStrikes: true,
  skill: { rangefinderError: 1.1, dispersion: 1.1 },
};
