import type { ShipSpec, TurretSpec } from '../../render/ships/forge/spec';

/**
 * A German torpedo boat of the 1900s ("SMS S 144"): 67 metres, three thin funnels, a raised forecastle, two 8.8 cm guns, and two
 * trainable twin torpedo mounts on the centreline. The tube mounts are drawn as turrets with two long barrels that train.
 */
const gun = (id: string, x: number, restTrainDeg: number): TurretSpec => ({
  id,
  x,
  z: 0,
  restTrainDeg,
  guns: 1,
  gunSpacing: 0,
  boreMm: 88,
  barrelLength: 2.8,
  minElevDeg: -10,
  maxElevDeg: 25,
  barbetteRadius: 0.7,
  barbetteHeight: 0.4,
  house: { rear: 0.7, front: 0.9, width: 1.3, height: 1.0, slope: 0.1 },
});

const tubeMount = (id: string, x: number): TurretSpec => ({
  id,
  x,
  z: 0,
  restTrainDeg: 0,
  trainArcDeg: [-150, 150],
  guns: 2,
  gunSpacing: 0.95,
  boreMm: 450,
  barrelLength: 5.2,
  // Tubes do not elevate.
  minElevDeg: 0,
  maxElevDeg: 0,
  barbetteRadius: 1.0,
  barbetteHeight: 0.35,
  house: { rear: 0.4, front: 0.5, width: 1.3, height: 0.7, slope: 0 },
});

export const DESTROYER: ShipSpec = {
  name: 'SMS S 144',
  hull: {
    length: 67,
    beam: 7.2,
    draft: 2.6,
    deckStern: 2.2,
    deckMid: 2.5,
    deckBow: 3.9,
    sternRound: 0.1,
    bodyEnd: 0.55,
    bowCurve: 1.8,
    bilge: 2.2,
    flareBow: 0.08,
    tumblehome: 0.0,
    bowRake: 0.9,
    sternOverhang: 0.6,
    bulwarks: [{ from: 0.68, to: 0.96, height: 0.75 }],
  },
  turrets: [gun('G1', 22, 0), gun('G2', -25, 180), tubeMount('T1', 5), tubeMount('T2', -8)],
  funnels: [
    { x: 13, halfLength: 1.1, halfWidth: 0.95, height: 4.6, taper: 0.05 },
    { x: 1, halfLength: 1.1, halfWidth: 0.95, height: 4.8, taper: 0.05 },
    { x: -17, halfLength: 1.1, halfWidth: 0.95, height: 4.4, taper: 0.05 },
  ],
  masts: [{ kind: 'pole', legs: [[17, 0]], height: 11, topmast: 3, platformRadius: 0.8 }],
  blocks: [
    { x: 18.5, length: 4.4, width: 4.2, height: 2.1, windows: 'front' },
    { x: -2, length: 5, width: 3.4, height: 1.6, windows: 'none' },
  ],
  boats: [
    { x: 8, z: -2.2, length: 4.2 },
    { x: 8, z: 2.2, length: 4.2 },
  ],
  vents: [
    { x: 7, z: -1.4 },
    { x: 7, z: 1.4 },
    { x: -13, z: -1.4 },
    { x: -13, z: 1.4 },
  ],
  lights: [{ x: 18, z: 0, lift: 2.2 }],
  lightGuns: [],
  staffs: [
    { x: -32, height: 3.2 },
    { x: 31, height: 2.4 },
  ],
};
