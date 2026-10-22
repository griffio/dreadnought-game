import type { ShipSpec, TurretSpec } from '../../render/ships/forge/spec';

/**
 * HMS Dreadnought as completed in 1906: 160.6 m, five twin 12-inch turrets (one forward, two wing, two
 * aft), two funnels, and the tripod foremast stepped abaft the forward funnel. Dimensions are the
 * published ones rounded; positions are laid out to give the right silhouette, not a draughtsman's plan.
 */
const twelveInch = (
  id: string,
  x: number,
  z: number,
  restTrainDeg: number,
  trainArcDeg: readonly [number, number],
): TurretSpec => ({
  id,
  x,
  z,
  restTrainDeg,
  trainArcDeg,
  guns: 2,
  gunSpacing: 2.5,
  boreMm: 305,
  barrelLength: 12.0,
  minElevDeg: -3,
  maxElevDeg: 13.5,
  barbetteRadius: 4.7,
  barbetteHeight: 1.1,
  house: { rear: 3.6, front: 4.0, width: 7.9, height: 2.8, slope: 1.1 },
  roofGuns: 2,
});

/** A 12-pounder on a pedestal or a roof: the anti-destroyer battery. Positions give the silhouette's light guns. */
const twelvePounder = (id: string, x: number, z: number, lift: number): TurretSpec => ({
  id,
  x,
  z,
  restTrainDeg: z < 0 ? -90 : 90,
  guns: 1,
  gunSpacing: 0,
  boreMm: 76,
  barrelLength: 2.3,
  minElevDeg: -10,
  maxElevDeg: 20,
  barbetteRadius: 0.55,
  barbetteHeight: lift,
  house: { rear: 0.55, front: 0.75, width: 1.1, height: 0.9, slope: 0.1 },
});

export const DREADNOUGHT: ShipSpec = {
  name: 'HMS Dreadnought',
  hull: {
    length: 160.6,
    beam: 25.0,
    draft: 8.1,
    deckStern: 4.6,
    deckMid: 5.2,
    deckBow: 6.6,
    sternRound: 0.11,
    bodyEnd: 0.58,
    bowCurve: 1.9,
    bilge: 2.6,
    flareBow: 0.14,
    tumblehome: 0.03,
    bowRake: 3.2,
    sternOverhang: 1.6,
    bulwarks: [
      { from: 0.6, to: 0.93, height: 1.0 },
      { from: 0.05, to: 0.2, height: 0.9 },
    ],
  },
  turrets: [
    // Arcs give the real battery its shape: eight guns on either beam, six ahead, four astern.
    twelveInch('A', 56, 0, 0, [-150, 150]),
    twelveInch('P', 9, -8.7, 0, [-170, 20]),
    twelveInch('Q', 9, 8.7, 0, [-20, 170]),
    twelveInch('X', -33.5, 0, 180, [60, 300]),
    twelveInch('Y', -60, 0, 180, [40, 320]),
    twelvePounder('L1', 42.5, -4.1, 3.3),
    twelvePounder('L2', 42.5, 4.1, 3.3),
    twelvePounder('L3', 36, -4.3, 3.3),
    twelvePounder('L4', 36, 4.3, 3.3),
    twelvePounder('L5', 8.5, -3.2, 3.1),
    twelvePounder('L6', 8.5, 3.2, 3.1),
    twelvePounder('L7', -1, -3.2, 3.1),
    twelvePounder('L8', -1, 3.2, 3.1),
    twelvePounder('L9', -20, -2.9, 2.5),
    twelvePounder('L10', -24, 2.9, 2.5),
  ],
  funnels: [
    { x: 26, halfLength: 3.2, halfWidth: 2.2, height: 13.5, taper: 0.06 },
    { x: -10, halfLength: 3.2, halfWidth: 2.2, height: 12.5, taper: 0.06 },
  ],
  masts: [
    {
      kind: 'tripod',
      legs: [
        [19, -4.2],
        [19, 4.2],
        [8.5, 0],
      ],
      height: 26,
      topmast: 9,
      platformRadius: 2.0,
      platforms: [0.3, 0.6],
    },
    { kind: 'pole', legs: [[-21, 0]], height: 17, topmast: 7, platformRadius: 1.3 },
  ],
  blocks: [
    { x: 40, length: 9, width: 9.5, height: 3.2, windows: 'all' },
    { x: 41, length: 5, width: 6.5, height: 2.6, lift: 3.2, windows: 'front' },
    { x: 4, length: 14, width: 7.4, height: 3.0, windows: 'all' },
    { x: -22, length: 6, width: 6.5, height: 2.4, windows: 'front' },
  ],
  conning: { x: 46.2, radius: 2.1, height: 3.8, lift: 0 },
  boats: [
    { x: 2, z: -1.9, length: 8.6 },
    { x: 2, z: 1.9, length: 8.6 },
    { x: -5, z: -1.9, length: 7.6 },
    { x: -5, z: 1.9, length: 7.6 },
  ],
  vents: [
    { x: 31, z: -3.8 },
    { x: 31, z: 3.8 },
    { x: 21, z: -6.2 },
    { x: 21, z: 6.2 },
    { x: -5, z: -4.4 },
    { x: -5, z: 4.4 },
    { x: -15, z: -4.4 },
    { x: -15, z: 4.4 },
    { x: -47, z: -4.6 },
    { x: -47, z: 4.6 },
  ],
  lights: [
    { x: 38.5, z: -4.4, lift: 3.4 },
    { x: 38.5, z: 4.4, lift: 3.4 },
    { x: 4, z: -3.2, lift: 3.4 },
    { x: 4, z: 3.2, lift: 3.4 },
    { x: -22, z: 0, lift: 2.6 },
  ],
  // The 12-pounders are real mounts (see `twelvePounder`): they train and fire.
  lightGuns: [],
  staffs: [
    { x: -77, height: 6.5 },
    { x: 76, height: 4.0 },
  ],
};
