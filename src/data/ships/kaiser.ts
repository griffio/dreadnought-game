import type { ShipSpec } from '../../render/ships/forge/spec';
import { heavyTurret, sideMount, type HeavyTurret } from './kit';

/**
 * SMS Kaiser as completed in 1912: 172.4 m, ten 30.5 cm guns in five twin turrets (one forward, a pair of wing turrets in
 * echelon amidships, two aft), a battery of 15 cm guns in casemates, three funnels and two military masts. The German answer to
 * the Orion class: fewer, lighter guns than the British 13.5-inch ships, but a flat, fast shell and very good armour and
 * subdivision. Dimensions are the published ones rounded.
 */
const heavy = (t: Pick<HeavyTurret, 'id' | 'x' | 'z' | 'rest' | 'arc' | 'raised'>) =>
  heavyTurret({
    ...t,
    guns: 2,
    spacing: 2.5,
    boreMm: 305,
    barrel: 13.2,
    minElev: -5,
    maxElev: 16,
    radius: 4.7,
    house: { rear: 3.5, front: 4.0, width: 7.6, height: 2.8, slope: 1.0 },
  });

const casemate = (id: string, x: number, side: 1 | -1) =>
  sideMount({
    id,
    x,
    offset: 9.6,
    side,
    guns: 1,
    spacing: 0,
    boreMm: 149,
    barrel: 5.6,
    minElev: -7,
    maxElev: 20,
    radius: 1.3,
    lift: 0.4,
    house: { rear: 1.3, front: 1.5, width: 2.3, height: 1.5, slope: 0.3 },
  });

export const KAISER_CASEMATE_X = [44, 36, 28, 4, -12, -22] as const;

export const KAISER: ShipSpec = {
  name: 'SMS Kaiser',
  hull: {
    length: 172.4,
    beam: 29.0,
    draft: 8.9,
    deckStern: 4.6,
    deckMid: 5.4,
    deckBow: 7.0,
    sternRound: 0.11,
    bodyEnd: 0.6,
    bowCurve: 2.0,
    bilge: 2.5,
    flareBow: 0.06,
    tumblehome: 0.05,
    bowRake: 0.8,
    sternOverhang: 1.2,
    bulwarks: [{ from: 0.62, to: 0.95, height: 0.9 }],
  },
  turrets: [
    heavy({ id: 'A', x: 58, arc: [-150, 150] }),
    heavy({ id: 'P', x: 18, z: -8.8, rest: -90, arc: [-165, 20] }),
    heavy({ id: 'Q', x: -4, z: 8.8, rest: 90, arc: [-20, 165] }),
    heavy({ id: 'X', x: -42, rest: 180, arc: [50, 310], raised: 3.4 }),
    heavy({ id: 'Y', x: -60, rest: 180, arc: [30, 330] }),
    ...KAISER_CASEMATE_X.map((x, i) => casemate(`S${i + 1}`, x, 1)),
    ...KAISER_CASEMATE_X.map((x, i) => casemate(`P${i + 1}`, x, -1)),
  ],
  funnels: [
    { x: 24, halfLength: 2.8, halfWidth: 2.4, height: 12.5, taper: 0.05 },
    { x: 6, halfLength: 2.8, halfWidth: 2.4, height: 12.5, taper: 0.05 },
    { x: -12, halfLength: 2.8, halfWidth: 2.4, height: 12, taper: 0.05 },
  ],
  masts: [
    { kind: 'pole', legs: [[32, 0]], height: 25, topmast: 8, platformRadius: 1.8, platforms: [0.5] },
    { kind: 'pole', legs: [[-28, 0]], height: 20, topmast: 7, platformRadius: 1.5 },
  ],
  blocks: [
    { x: 38, length: 11, width: 9.4, height: 3.4, windows: 'all' },
    { x: 39, length: 6, width: 7, height: 2.6, lift: 3.4, windows: 'front' },
    { x: 6, length: 36, width: 8, height: 2.4, windows: 'front' },
    { x: -30, length: 7, width: 6.5, height: 2.4, windows: 'front' },
  ],
  conning: { x: 44.4, radius: 2.1, height: 3.6, lift: 0 },
  boats: [
    { x: -6, z: -3.4, length: 8.2 },
    { x: -6, z: 3.4, length: 8.2 },
    { x: 14, z: -3.4, length: 7.6 },
    { x: 14, z: 3.4, length: 7.6 },
  ],
  vents: [
    { x: 30, z: -4.4 },
    { x: 30, z: 4.4 },
    { x: -2, z: -4.6 },
    { x: -2, z: 4.6 },
    { x: -20, z: -4.4 },
    { x: -20, z: 4.4 },
  ],
  lights: [
    { x: 36, z: -4.4, lift: 3.4 },
    { x: 36, z: 4.4, lift: 3.4 },
    { x: -30, z: 0, lift: 2.6 },
  ],
  lightGuns: [],
  staffs: [
    { x: -83, height: 6 },
    { x: 82, height: 3.8 },
  ],
};
