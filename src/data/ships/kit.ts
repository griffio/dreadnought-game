import type { TurretSpec } from '../../render/ships/forge/spec';
import type { TubeSpec } from '../../sim/torpedo/spec';

/** Height of a barbette above the deck for a turret that stands on it, and the extra a superfiring turret is lifted over its neighbour. */
const BARBETTE = 1.1;

export interface HouseSpec {
  rear: number;
  front: number;
  width: number;
  height: number;
  slope: number;
}

export interface HeavyTurret {
  id: string;
  x: number;
  z?: number;
  /** Where it rests (0 = ahead, 180 = aft) and the bearings it can fire on. */
  rest?: number;
  arc: readonly [number, number];
  guns: number;
  spacing: number;
  boreMm: number;
  barrel: number;
  minElev?: number;
  maxElev: number;
  radius: number;
  /** Metres it is lifted above the deck turret: a superfiring turret stands on a tall barbette. */
  raised?: number;
  house: HouseSpec;
}

/** A turret for the big guns of a capital ship. */
export const heavyTurret = (t: HeavyTurret): TurretSpec => ({
  id: t.id,
  x: t.x,
  z: t.z ?? 0,
  restTrainDeg: t.rest ?? 0,
  trainArcDeg: t.arc,
  guns: t.guns,
  gunSpacing: t.spacing,
  boreMm: t.boreMm,
  barrelLength: t.barrel,
  minElevDeg: t.minElev ?? -3,
  maxElevDeg: t.maxElev,
  barbetteRadius: t.radius,
  barbetteHeight: BARBETTE + (t.raised ?? 0),
  house: t.house,
});

export interface SideMount {
  id: string;
  x: number;
  /** Distance from the centre line, metres; the sign comes from `side`. */
  offset: number;
  /** +1 starboard, -1 port. */
  side: 1 | -1;
  guns: number;
  spacing: number;
  boreMm: number;
  barrel: number;
  minElev: number;
  maxElev: number;
  radius: number;
  lift: number;
  house: HouseSpec;
  /** Half the width of the arc it commands about the beam, degrees. Default 65. */
  halfArc?: number;
}

/** A gun in a casemate or a secondary turret on the side of the ship: it fires over its own beam and not across the deck. */
export const sideMount = (m: SideMount): TurretSpec => {
  const half = m.halfArc ?? 65;
  const lo = 90 - half;
  const hi = 90 + half;
  return {
    id: m.id,
    x: m.x,
    z: m.side * m.offset,
    restTrainDeg: m.side * 90,
    trainArcDeg: m.side > 0 ? [lo, hi] : [-hi, -lo],
    guns: m.guns,
    gunSpacing: m.spacing,
    boreMm: m.boreMm,
    barrelLength: m.barrel,
    minElevDeg: m.minElev,
    maxElevDeg: m.maxElev,
    barbetteRadius: m.radius,
    barbetteHeight: m.lift,
    house: m.house,
  };
};

/** A submerged tube on the beam: it can fire on a narrow arc around its axis (the angle its torpedo's gyroscope can turn through). */
export const beamTube = (id: string, x: number, bearing: number, rounds = 2): TubeSpec => ({
  id,
  x,
  z: 0,
  arcDeg: [bearing - 18, bearing + 18],
  trainRateDegPerSec: 0,
  reloadSeconds: 180,
  rounds,
  restBearingDeg: bearing,
});

/** Ids 'S1'..'Sn' down the starboard side and 'P1'..'Pn' down the port side, for a battery laid out by x. */
export const sideIds = (n: number): { starboard: string[]; port: string[]; all: string[] } => {
  const starboard = Array.from({ length: n }, (_, i) => `S${i + 1}`);
  const port = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  return { starboard, port, all: [...starboard, ...port] };
};
