import type { ShipSpec } from '../../render/ships/forge/spec';
import { heavyTurret, sideMount, type HeavyTurret } from './kit';

/**
 * HMS Queen Elizabeth as completed in 1915: 196.8 m, four twin 15-inch turrets (two forward, two aft, each pair superfiring),
 * a battery of 6-inch guns in casemates along the main deck, two funnels, and a tripod foremast abaft the bridge. The first
 * fast battleship, and the first with a 15-inch gun. Dimensions are the published ones rounded.
 */
const fifteenInch = (t: Pick<HeavyTurret, 'id' | 'x' | 'rest' | 'arc' | 'raised'>) =>
  heavyTurret({
    ...t,
    guns: 2,
    spacing: 2.8,
    boreMm: 381,
    barrel: 14.0,
    maxElev: 20,
    radius: 5.0,
    house: { rear: 3.9, front: 4.4, width: 8.6, height: 2.9, slope: 1.2 },
  });

/** Six-inch guns in casemates: each fires through the ship's side. */
const casemate = (id: string, x: number, side: 1 | -1) =>
  sideMount({
    id,
    x,
    offset: 10.4,
    side,
    guns: 1,
    spacing: 0,
    boreMm: 152,
    barrel: 5.6,
    minElev: -7,
    maxElev: 15,
    radius: 1.3,
    lift: 0.4,
    house: { rear: 1.3, front: 1.5, width: 2.3, height: 1.5, slope: 0.3 },
  });

export const CASEMATE_X = [32, 24, 16, 8, 0, -8] as const;

export const QUEEN_ELIZABETH: ShipSpec = {
  name: 'HMS Queen Elizabeth',
  hull: {
    length: 196.8,
    beam: 27.6,
    draft: 8.9,
    deckStern: 5.0,
    deckMid: 5.6,
    deckBow: 7.6,
    sternRound: 0.1,
    bodyEnd: 0.58,
    bowCurve: 2.0,
    bilge: 2.6,
    flareBow: 0.12,
    tumblehome: 0.03,
    bowRake: 3.0,
    sternOverhang: 1.8,
    bulwarks: [
      { from: 0.62, to: 0.94, height: 1.0 },
      { from: 0.04, to: 0.2, height: 0.9 },
    ],
  },
  turrets: [
    fifteenInch({ id: 'A', x: 68, arc: [-150, 150] }),
    fifteenInch({ id: 'B', x: 50, arc: [-150, 150], raised: 3.4 }),
    fifteenInch({ id: 'X', x: -52, rest: 180, arc: [50, 310], raised: 3.4 }),
    fifteenInch({ id: 'Y', x: -70, rest: 180, arc: [35, 325] }),
    ...CASEMATE_X.map((x, i) => casemate(`S${i + 1}`, x, 1)),
    ...CASEMATE_X.map((x, i) => casemate(`P${i + 1}`, x, -1)),
  ],
  funnels: [
    { x: 14, halfLength: 3.4, halfWidth: 3.0, height: 14, taper: 0.06 },
    { x: -9, halfLength: 3.2, halfWidth: 2.8, height: 12.5, taper: 0.06 },
  ],
  masts: [
    {
      kind: 'tripod',
      legs: [
        [30, -4.5],
        [30, 4.5],
        [19.5, 0],
      ],
      height: 30,
      topmast: 10,
      platformRadius: 2.1,
      platforms: [0.3, 0.62],
    },
    { kind: 'pole', legs: [[-31, 0]], height: 20, topmast: 7, platformRadius: 1.4 },
  ],
  blocks: [
    { x: 38, length: 10, width: 10, height: 3.4, windows: 'all' },
    { x: 39, length: 6, width: 7, height: 2.8, lift: 3.4, windows: 'front' },
    { x: 3, length: 20, width: 7.6, height: 3.0, windows: 'all' },
    { x: -33, length: 7, width: 7, height: 2.4, windows: 'front' },
  ],
  conning: { x: 43.6, radius: 2.2, height: 3.8, lift: 0 },
  boats: [
    { x: -20, z: -5.6, length: 9.0 },
    { x: -20, z: 5.6, length: 9.0 },
    { x: -28, z: -5.6, length: 8.0 },
    { x: -28, z: 5.6, length: 8.0 },
  ],
  vents: [
    { x: 28, z: -4.2 },
    { x: 28, z: 4.2 },
    { x: 20, z: -6.4 },
    { x: 20, z: 6.4 },
    { x: -2, z: -4.6 },
    { x: -2, z: 4.6 },
    { x: -16, z: -4.6 },
    { x: -16, z: 4.6 },
    { x: -42, z: -4.8 },
    { x: -42, z: 4.8 },
  ],
  lights: [
    { x: 36, z: -4.6, lift: 3.6 },
    { x: 36, z: 4.6, lift: 3.6 },
    { x: 3, z: -3.2, lift: 3.4 },
    { x: 3, z: 3.2, lift: 3.4 },
    { x: -33, z: 0, lift: 2.6 },
  ],
  lightGuns: [],
  staffs: [
    { x: -95, height: 6.5 },
    { x: 94, height: 4.2 },
  ],
};
