import type { ShipSpec } from '../../render/ships/forge/spec';
import { heavyTurret, sideMount } from './kit';

/**
 * HMS King George V as she was in 1941: 227.1 m, ten 14-inch guns in two quadruple turrets (A and Y) and one twin (B), eight
 * twin 5.25-inch dual-purpose mounts, two funnels and a tower bridge. The treaty compromise: a lighter gun in more barrels, and
 * the quadruple mountings that jammed so often in her first fights. Dimensions are the published ones rounded.
 */
const fourteenQuad = (id: string, x: number, rest: number, arc: readonly [number, number]) =>
  heavyTurret({
    id,
    x,
    rest,
    arc,
    guns: 4,
    spacing: 2.2,
    boreMm: 356,
    barrel: 14.0,
    maxElev: 30,
    radius: 6.4,
    house: { rear: 4.8, front: 5.2, width: 11.4, height: 3.2, slope: 1.4 },
  });

const fourteenTwin = (id: string, x: number, arc: readonly [number, number]) =>
  heavyTurret({
    id,
    x,
    arc,
    guns: 2,
    spacing: 3.0,
    boreMm: 356,
    barrel: 14.0,
    maxElev: 30,
    radius: 5.2,
    raised: 3.6,
    house: { rear: 3.9, front: 4.4, width: 8.8, height: 2.9, slope: 1.2 },
  });

/** The 5.25-inch dual-purpose mounts: four a side. */
const dualPurpose = (id: string, x: number, side: 1 | -1) =>
  sideMount({
    id,
    x,
    offset: 9,
    side,
    guns: 2,
    spacing: 1.1,
    boreMm: 133,
    barrel: 5.8,
    minElev: -5,
    maxElev: 45,
    radius: 2.3,
    lift: 1.8,
    halfArc: 80,
    house: { rear: 2.0, front: 2.4, width: 3.2, height: 1.8, slope: 0.5 },
  });

export const DUAL_PURPOSE_X = [40, 24, -6, -22] as const;

export const KING_GEORGE_V: ShipSpec = {
  name: 'HMS King George V',
  hull: {
    length: 227.1,
    beam: 31.4,
    draft: 9.7,
    deckStern: 5.4,
    deckMid: 5.9,
    deckBow: 8.0,
    sternRound: 0.1,
    bodyEnd: 0.6,
    bowCurve: 2.1,
    bilge: 2.7,
    flareBow: 0.15,
    tumblehome: 0.03,
    bowRake: 4.0,
    sternOverhang: 2.5,
    bulwarks: [
      { from: 0.62, to: 0.95, height: 1.1 },
      { from: 0.04, to: 0.18, height: 0.9 },
    ],
  },
  turrets: [
    fourteenQuad('A', 80, 0, [-150, 150]),
    fourteenTwin('B', 60, [-150, 150]),
    fourteenQuad('Y', -68, 180, [40, 320]),
    ...DUAL_PURPOSE_X.map((x, i) => dualPurpose(`S${i + 1}`, x, 1)),
    ...DUAL_PURPOSE_X.map((x, i) => dualPurpose(`P${i + 1}`, x, -1)),
  ],
  funnels: [
    { x: 22, halfLength: 3.8, halfWidth: 3.4, height: 14, taper: 0.06 },
    { x: -8, halfLength: 3.6, halfWidth: 3.2, height: 13, taper: 0.06 },
  ],
  masts: [
    {
      kind: 'tripod',
      legs: [
        [40, -3.6],
        [40, 3.6],
        [32, 0],
      ],
      height: 32,
      topmast: 10,
      platformRadius: 2.0,
      platforms: [0.35, 0.68],
    },
    { kind: 'pole', legs: [[-34, 0]], height: 22, topmast: 8, platformRadius: 1.4 },
  ],
  blocks: [
    { x: 44, length: 14, width: 11, height: 4.2, windows: 'all' },
    { x: 44, length: 9, width: 8.2, height: 3.2, lift: 4.2, windows: 'front' },
    { x: 7, length: 22, width: 8, height: 3.0, windows: 'all' },
    { x: -18, length: 20, width: 9.4, height: 3.6, windows: 'front' },
    { x: -48, length: 8, width: 8, height: 2.6, windows: 'front' },
  ],
  conning: { x: 51.6, radius: 2.4, height: 4.0, lift: 0 },
  boats: [
    { x: 10, z: -6.4, length: 9.6 },
    { x: 10, z: 6.4, length: 9.6 },
    { x: -34, z: -6, length: 8.4 },
    { x: -34, z: 6, length: 8.4 },
  ],
  vents: [
    { x: 30, z: -5 },
    { x: 30, z: 5 },
    { x: 14, z: -6.4 },
    { x: 14, z: 6.4 },
    { x: -16, z: -6 },
    { x: -16, z: 6 },
    { x: -42, z: -4.8 },
    { x: -42, z: 4.8 },
  ],
  lights: [
    { x: 42, z: -5.2, lift: 4.4 },
    { x: 42, z: 5.2, lift: 4.4 },
    { x: -18, z: -4.4, lift: 3.8 },
    { x: -18, z: 4.4, lift: 3.8 },
    { x: -48, z: 0, lift: 2.8 },
  ],
  lightGuns: [],
  staffs: [
    { x: -110, height: 6.5 },
    { x: 109, height: 4.4 },
  ],
};
