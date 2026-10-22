import type { ShipSpec, TurretSpec } from '../../render/ships/forge/spec';

/**
 * A German pre-dreadnought of the Braunschweig type, about 1905: two twin 28 cm turrets, a casemate battery of twelve
 * 17 cm guns, two funnels, military masts. Slower and weaker in her main battery than HMS Dreadnought, but with
 * the secondary battery that makes close range dangerous. Dimensions are the published ones rounded.
 */
const heavy = (id: string, x: number, restTrainDeg: number, trainArcDeg: readonly [number, number]): TurretSpec => ({
  id,
  x,
  z: 0,
  restTrainDeg,
  trainArcDeg,
  guns: 2,
  gunSpacing: 2.2,
  boreMm: 280,
  barrelLength: 11.2,
  minElevDeg: -4,
  maxElevDeg: 30,
  barbetteRadius: 4.2,
  barbetteHeight: 1.0,
  house: { rear: 3.2, front: 3.6, width: 7.0, height: 2.6, slope: 0.9 },
});

/** A single 17 cm gun in a casemate: a small house on a short barbette, firing over the side. */
const casemate = (id: string, x: number, side: 1 | -1): TurretSpec => ({
  id,
  x,
  z: side * 8.4,
  restTrainDeg: side * 90,
  trainArcDeg: side > 0 ? [25, 155] : [-155, -25],
  guns: 1,
  gunSpacing: 0,
  boreMm: 172,
  barrelLength: 6.8,
  minElevDeg: -5,
  maxElevDeg: 20,
  barbetteRadius: 1.3,
  barbetteHeight: 0.4,
  house: { rear: 1.3, front: 1.5, width: 2.3, height: 1.5, slope: 0.3 },
});

const CASEMATE_X = [34, 24, 14, 4, -6, -16];

export const PRE_DREADNOUGHT: ShipSpec = {
  name: 'SMS Hessen',
  hull: {
    length: 127.7,
    beam: 22.2,
    draft: 7.7,
    deckStern: 4.4,
    deckMid: 5.0,
    deckBow: 6.4,
    sternRound: 0.12,
    bodyEnd: 0.6,
    bowCurve: 2.2,
    bilge: 2.4,
    flareBow: 0.05,
    tumblehome: 0.07,
    bowRake: 0.8,
    sternOverhang: 1.2,
    bulwarks: [{ from: 0.62, to: 0.95, height: 0.9 }],
  },
  turrets: [
    heavy('F', 41, 0, [-150, 150]),
    heavy('R', -41, 180, [30, 330]),
    ...CASEMATE_X.map((x, i) => casemate(`S${i + 1}`, x, 1)),
    ...CASEMATE_X.map((x, i) => casemate(`P${i + 1}`, x, -1)),
  ],
  funnels: [
    { x: 14, halfLength: 2.7, halfWidth: 2.3, height: 11.5, taper: 0.05 },
    { x: -8, halfLength: 2.7, halfWidth: 2.3, height: 11, taper: 0.05 },
  ],
  masts: [
    { kind: 'pole', legs: [[24, 0]], height: 21, topmast: 8, platformRadius: 1.7, platforms: [0.6] },
    { kind: 'pole', legs: [[-26, 0]], height: 17, topmast: 6, platformRadius: 1.4 },
  ],
  blocks: [
    { x: 26, length: 8, width: 8.4, height: 3, windows: 'all' },
    { x: 28, length: 4.5, width: 6, height: 2.4, lift: 3, windows: 'front' },
    { x: 3, length: 20, width: 9, height: 2.6, windows: 'all' },
    { x: -26, length: 6, width: 6.5, height: 2.2, windows: 'front' },
  ],
  conning: { x: 32, radius: 1.9, height: 3.2, lift: 0 },
  boats: [
    { x: 8, z: -3, length: 7.4 },
    { x: 8, z: 3, length: 7.4 },
    { x: -14, z: -3, length: 6.8 },
    { x: -14, z: 3, length: 6.8 },
  ],
  vents: [
    { x: 18, z: -4.2 },
    { x: 18, z: 4.2 },
    { x: -2, z: -4.4 },
    { x: -2, z: 4.4 },
    { x: -20, z: -4.2 },
    { x: -20, z: 4.2 },
  ],
  lights: [
    { x: 24, z: -4, lift: 3.2 },
    { x: 24, z: 4, lift: 3.2 },
    { x: -26, z: 0, lift: 2.4 },
  ],
  lightGuns: [
    { x: 29, z: -3.6, lift: 3.1, trainDeg: 90 },
    { x: 29, z: 3.6, lift: 3.1, trainDeg: 90 },
    { x: -24, z: -2.6, lift: 2.4, trainDeg: 90 },
    { x: -24, z: 2.6, lift: 2.4, trainDeg: 90 },
  ],
  staffs: [
    { x: -60, height: 6 },
    { x: 60, height: 3.6 },
  ],
};
