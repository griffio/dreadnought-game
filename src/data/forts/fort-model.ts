import type { FortSpec } from '../../sim/fort/fort';
import type { ShipSpec, TurretSpec } from '../../render/ships/forge/spec';

/** Height of the concrete apron the guns stand on above the ground, metres. */
export const APRON_HEIGHT = 0.6;

/**
 * A fort drawn with the same machinery as a ship: the works are a flat-decked "hull" sunk into the hillside (its flat concrete
 * apron is the deck), the emplacements are turrets that train and elevate and recoil, the command post is a block and the lookout
 * a pole mast. Ship space has the bow to the north, so an emplacement's east and south offsets become (x, z) = (-south, east).
 */
export function fortShipSpec(spec: FortSpec): ShipSpec {
  let reachX = 0;
  let reachZ = 0;
  for (const e of spec.emplacements) {
    reachX = Math.max(reachX, Math.abs(e.dz) + e.radius);
    reachZ = Math.max(reachZ, Math.abs(e.dx) + e.radius);
  }
  const length = Math.max(2 * reachX + 28, 40);
  const beam = Math.max(2 * reachZ + 28, 36);
  const cased = spec.emplacements.some((e) => e.frontMm > 0);
  const big = spec.gun.boreMm > 200;

  const turrets: TurretSpec[] = spec.emplacements.map((e) => ({
    id: e.id,
    x: -e.dz,
    z: e.dx,
    restTrainDeg: e.arc?.centreDeg ?? 0,
    trainArcDeg: e.arc ? [e.arc.centreDeg - e.arc.halfDeg, e.arc.centreDeg + e.arc.halfDeg] : undefined,
    guns: 1,
    gunSpacing: 0,
    boreMm: spec.gun.boreMm,
    barrelLength: big ? 6 : 4.5,
    minElevDeg: spec.gun.highAngle ? 0 : -5,
    maxElevDeg: spec.gun.maxElevationDeg,
    barbetteRadius: e.radius * (cased ? 0.7 : 0.55),
    barbetteHeight: cased ? 1.4 : 0.8,
    house: cased
      ? { rear: 2.4, front: 2.6, width: 4.4, height: 2.2, slope: 0.5 }
      : { rear: 1.3, front: 1.5, width: 2.4, height: spec.gun.highAngle ? 1.4 : 1.1, slope: 0.1 },
  }));

  return {
    name: spec.name,
    hull: {
      length,
      beam,
      draft: 4,
      deckStern: APRON_HEIGHT,
      deckMid: APRON_HEIGHT,
      deckBow: APRON_HEIGHT,
      sternRound: 0.02,
      bodyEnd: 0.98,
      bowCurve: 14,
      bilge: 10,
      flareBow: 0,
      tumblehome: 0,
      bowRake: 0,
      sternOverhang: 0,
      bulwarks: [],
    },
    turrets,
    funnels: [],
    masts: [{ kind: 'pole', legs: [[-length * 0.28, beam * 0.3]], height: 9, topmast: 3, platformRadius: 0.9 }],
    blocks: [
      { x: -length * 0.2, z: -beam * 0.22, length: 7, width: 5, height: 3, windows: 'front' },
      { x: length * 0.22, z: beam * 0.25, length: 5, width: 4, height: 2.2, windows: 'none' },
    ],
    boats: [],
    vents: [],
    lights: [{ x: length * 0.3, z: -beam * 0.3, lift: 2 }],
    lightGuns: [],
    staffs: [{ x: -length * 0.42, height: 7 }],
  };
}
