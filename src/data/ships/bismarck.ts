import type { ShipSpec } from '../../render/ships/forge/spec';
import { heavyTurret, sideMount, type HeavyTurret } from './kit';

/**
 * The battleship Bismarck as she sailed in May 1941: 251 m, eight 38 cm guns in four twin turrets (two forward, two aft, each
 * pair superfiring), six twin 15 cm turrets, one broad funnel and a tall tower foremast with its gunnery directors. The best
 * gunnery ship of her day, and the best protected. Dimensions are the published ones rounded.
 */
const heavy = (t: Pick<HeavyTurret, 'id' | 'x' | 'rest' | 'arc' | 'raised'>) =>
  heavyTurret({
    ...t,
    guns: 2,
    spacing: 3.0,
    boreMm: 380,
    barrel: 15.6,
    minElev: -5,
    maxElev: 30,
    radius: 6.2,
    house: { rear: 4.6, front: 5.2, width: 10.2, height: 3.2, slope: 1.4 },
  });

const secondary = (id: string, x: number, side: 1 | -1) =>
  sideMount({
    id,
    x,
    offset: 11.5,
    side,
    guns: 2,
    spacing: 1.5,
    boreMm: 149,
    barrel: 6.6,
    minElev: -10,
    maxElev: 40,
    radius: 2.4,
    lift: 1.6,
    halfArc: 80,
    house: { rear: 2.3, front: 2.6, width: 4.4, height: 2.0, slope: 0.5 },
  });

export const BISMARCK_SECONDARY_X = [38, 12, -28] as const;

export const BISMARCK: ShipSpec = {
  name: 'Bismarck',
  hull: {
    length: 251,
    beam: 36,
    draft: 9.3,
    deckStern: 6.0,
    deckMid: 7.0,
    deckBow: 9.0,
    sternRound: 0.1,
    bodyEnd: 0.6,
    bowCurve: 2.2,
    bilge: 2.8,
    flareBow: 0.15,
    tumblehome: 0.03,
    bowRake: 4.5,
    sternOverhang: 3.0,
    bulwarks: [
      { from: 0.62, to: 0.96, height: 1.1 },
      { from: 0.04, to: 0.16, height: 0.9 },
    ],
  },
  turrets: [
    heavy({ id: 'A', x: 92, arc: [-150, 150] }),
    heavy({ id: 'B', x: 70, arc: [-150, 150], raised: 4.6 }),
    heavy({ id: 'X', x: -58, rest: 180, arc: [40, 320], raised: 4.6 }),
    heavy({ id: 'Y', x: -80, rest: 180, arc: [30, 330] }),
    ...BISMARCK_SECONDARY_X.map((x, i) => secondary(`S${i + 1}`, x, 1)),
    ...BISMARCK_SECONDARY_X.map((x, i) => secondary(`P${i + 1}`, x, -1)),
  ],
  funnels: [{ x: -6, halfLength: 5.2, halfWidth: 3.9, height: 16, taper: 0.1 }],
  masts: [
    {
      kind: 'tripod',
      legs: [
        [44, -3.2],
        [44, 3.2],
        [34, 0],
      ],
      height: 36,
      topmast: 8,
      platformRadius: 2.4,
      platforms: [0.3, 0.55, 0.8],
    },
    { kind: 'pole', legs: [[-38, 0]], height: 24, topmast: 8, platformRadius: 1.6 },
  ],
  blocks: [
    { x: 46, length: 14, width: 12, height: 4.4, windows: 'all' },
    { x: 46, length: 9, width: 8.6, height: 3.4, lift: 4.4, windows: 'front' },
    { x: 26, length: 12, width: 9.4, height: 3.0, windows: 'front' },
    { x: -24, length: 22, width: 9.6, height: 3.6, windows: 'front' },
    { x: -44, length: 6, width: 7, height: 3.0, windows: 'front' },
  ],
  conning: { x: 54, radius: 2.6, height: 4.2, lift: 0 },
  boats: [
    { x: 4, z: -7.6, length: 9.6 },
    { x: 4, z: 7.6, length: 9.6 },
    { x: -14, z: -7.8, length: 8.8 },
    { x: -14, z: 7.8, length: 8.8 },
  ],
  vents: [
    { x: 32, z: -6 },
    { x: 32, z: 6 },
    { x: 18, z: -6.4 },
    { x: 18, z: 6.4 },
    { x: -16, z: -6 },
    { x: -16, z: 6 },
    { x: -46, z: -5 },
    { x: -46, z: 5 },
  ],
  lights: [
    { x: 48, z: -5.4, lift: 4.6 },
    { x: 48, z: 5.4, lift: 4.6 },
    { x: -24, z: -4.6, lift: 3.8 },
    { x: -24, z: 4.6, lift: 3.8 },
    { x: -44, z: 0, lift: 3.2 },
  ],
  lightGuns: [],
  staffs: [
    { x: -121, height: 6.5 },
    { x: 120, height: 4.4 },
  ],
};
