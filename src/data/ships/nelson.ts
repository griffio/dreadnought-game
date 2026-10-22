import type { ShipSpec } from '../../render/ships/forge/spec';
import { heavyTurret, sideMount, type HeavyTurret } from './kit';

/**
 * HMS Rodney, a Nelson-class battleship as she was in 1941: 216.6 m, three triple 16-inch turrets all forward of the bridge,
 * a tall tower amidships, a single funnel, and six twin 6-inch turrets on the quarterdeck. The treaty ships' design put the
 * armour in a short, thick citadel and the weight of the guns in the bow. Dimensions are the published ones rounded.
 */
const sixteenInch = (t: Pick<HeavyTurret, 'id' | 'x' | 'arc' | 'raised'>) =>
  heavyTurret({
    ...t,
    guns: 3,
    spacing: 2.6,
    boreMm: 406,
    barrel: 16.0,
    maxElev: 30,
    radius: 6.3,
    house: { rear: 4.8, front: 5.2, width: 11.2, height: 3.2, slope: 1.4 },
  });

/** The 6-inch twin turrets: three a side, abaft the funnel. */
const sixInch = (id: string, x: number, side: 1 | -1) =>
  sideMount({
    id,
    x,
    offset: 10,
    side,
    guns: 2,
    spacing: 1.2,
    boreMm: 152,
    barrel: 6.8,
    minElev: -5,
    maxElev: 45,
    radius: 2.5,
    lift: 1.3,
    halfArc: 80,
    house: { rear: 2.2, front: 2.6, width: 3.6, height: 1.9, slope: 0.6 },
  });

export const SIX_INCH_X = [-20, -33, -46] as const;

export const NELSON: ShipSpec = {
  name: 'HMS Rodney',
  hull: {
    length: 216.6,
    beam: 32.3,
    draft: 9.4,
    deckStern: 4.6,
    deckMid: 5.7,
    deckBow: 7.6,
    sternRound: 0.1,
    bodyEnd: 0.55,
    bowCurve: 1.9,
    bilge: 2.6,
    flareBow: 0.1,
    tumblehome: 0.0,
    bowRake: 2.8,
    sternOverhang: 2.0,
    bulwarks: [{ from: 0.62, to: 0.95, height: 1.0 }],
  },
  turrets: [
    sixteenInch({ id: 'A', x: 84, arc: [-150, 150] }),
    sixteenInch({ id: 'B', x: 66, arc: [-150, 150], raised: 4.6 }),
    sixteenInch({ id: 'C', x: 46, arc: [-150, 150] }),
    ...SIX_INCH_X.map((x, i) => sixInch(`S${i + 1}`, x, 1)),
    ...SIX_INCH_X.map((x, i) => sixInch(`P${i + 1}`, x, -1)),
  ],
  funnels: [{ x: -4, halfLength: 4.6, halfWidth: 3.6, height: 13, taper: 0.06 }],
  masts: [
    { kind: 'pole', legs: [[18, 0]], height: 30, topmast: 8, platformRadius: 1.9, platforms: [0.5, 0.78] },
    { kind: 'pole', legs: [[-38, 0]], height: 22, topmast: 7, platformRadius: 1.4 },
  ],
  blocks: [
    { x: 20, length: 18, width: 12, height: 5.2, windows: 'all' },
    { x: 20, length: 12, width: 9, height: 4.2, lift: 5.2, windows: 'all' },
    { x: 20, length: 7, width: 6.4, height: 3.4, lift: 9.4, windows: 'front' },
    { x: -26, length: 14, width: 8.4, height: 2.6, windows: 'front' },
  ],
  conning: { x: 32, radius: 2.5, height: 4.0, lift: 0 },
  boats: [
    { x: 4, z: -7, length: 9.4 },
    { x: 4, z: 7, length: 9.4 },
    { x: -10, z: -7.4, length: 8.2 },
    { x: -10, z: 7.4, length: 8.2 },
  ],
  vents: [
    { x: 8, z: -5.4 },
    { x: 8, z: 5.4 },
    { x: -14, z: -5 },
    { x: -14, z: 5 },
    { x: -42, z: -4.8 },
    { x: -42, z: 4.8 },
    { x: -58, z: -4.4 },
    { x: -58, z: 4.4 },
  ],
  lights: [
    { x: 24, z: -5.4, lift: 5.4 },
    { x: 24, z: 5.4, lift: 5.4 },
    { x: -26, z: 0, lift: 2.8 },
  ],
  lightGuns: [],
  staffs: [
    { x: -104, height: 6.5 },
    { x: 103, height: 4.2 },
  ],
};
