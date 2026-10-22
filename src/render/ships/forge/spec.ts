import type { HullSpec } from './hull';
import type { V3 } from './mesh-builder';

/** Declarative description of a ship. The Forge turns it into geometry; the sim reads the same data. */
export interface TurretSpec {
  id: string;
  /** Position of the turret axis on the deck, ship space. */
  x: number;
  z: number;
  /** Where the turret rests: 0 = trained ahead, 180 = aft. */
  restTrainDeg: number;
  guns: number;
  gunSpacing: number;
  /** Bore diameter, mm (documentation and later ballistics; drives barrel thickness). */
  boreMm: number;
  /** Trunnion to muzzle, metres. */
  barrelLength: number;
  minElevDeg: number;
  maxElevDeg: number;
  /**
   * The bearings the turret can fire on, degrees clockwise from the bow as one contiguous range that may run past 180
   * (an aft turret is [60, 300], which is 60 round through astern to -60). Outside it the blast would hit the ship's own
   * superstructure and the training gear stops the house. Default: all round.
   */
  trainArcDeg?: readonly [number, number];
  barbetteRadius: number;
  barbetteHeight: number;
  house: {
    /** Metres behind and ahead of the axis. */
    rear: number;
    front: number;
    width: number;
    height: number;
    /** Metres the front plate leans back over its height (the sloped gun-port face). */
    slope: number;
  };
  /** Light guns carried on the roof, trained with the turret. */
  roofGuns?: number;
}

export interface FunnelSpec {
  x: number;
  z?: number;
  /** Half-extent fore-and-aft and athwartships at the base, metres. */
  halfLength: number;
  halfWidth: number;
  /** Height above the deck. */
  height: number;
  /** Fraction narrower at the top. */
  taper: number;
}

export interface MastSpec {
  kind: 'tripod' | 'pole';
  /** Where the legs (tripod) or the mast (pole) stand, x/z in ship space. */
  legs: readonly [number, number][];
  /** Height of the top platform above the deck. */
  height: number;
  /** Topmast pole height above the platform. */
  topmast: number;
  /** Radius of the top platform. */
  platformRadius: number;
  /** Extra platforms as fractions of the height. */
  platforms?: readonly number[];
}

export interface BlockSpec {
  x: number;
  z?: number;
  length: number;
  width: number;
  height: number;
  /** Height of the base above the deck (0 = on deck). */
  lift?: number;
  windows: 'none' | 'front' | 'all';
}

export interface ShipSpec {
  name: string;
  hull: HullSpec;
  turrets: TurretSpec[];
  funnels: FunnelSpec[];
  masts: MastSpec[];
  blocks: BlockSpec[];
  /** Conning tower: a short armoured cylinder. */
  conning?: { x: number; radius: number; height: number; lift: number };
  boats: { x: number; z: number; length: number }[];
  vents: { x: number; z: number }[];
  lights: { x: number; z: number; lift: number }[];
  /** 12-pounder-class light guns on the superstructure edges. */
  lightGuns: { x: number; z: number; lift: number; trainDeg: number }[];
  /** Flag staffs: ensign staff aft, jack staff forward. */
  staffs: { x: number; height: number }[];
}

export interface NodeDef {
  name: string;
  parent: number;
  /** Pivot in ship space about which this node's animation rotates. */
  pivot: V3;
}

export interface TurretRef {
  id: string;
  houseNode: number;
  barrelNodes: number[];
  restTrainDeg: number;
  /** Vertical training axis, ship space. */
  axis: V3;
  /** Trunnion per barrel, ship space. */
  trunnions: V3[];
  /** Muzzle offset from the trunnion at zero elevation, along the barrel (+x in the house frame). */
  muzzleOffset: V3;
  minElevDeg: number;
  maxElevDeg: number;
  trainMinDeg: number;
  trainMaxDeg: number;
  boreMm: number;
  guns: number;
  gunSpacing: number;
}

export interface ShipModel {
  name: string;
  vertices: ArrayBuffer;
  vertexCount: number;
  indices: Uint32Array;
  nodes: NodeDef[];
  turrets: TurretRef[];
  length: number;
  beam: number;
  draft: number;
  /** Waterline half-breadth at a ship-space x (metres from amidships, +x toward the bow). For wakes and spray. */
  waterlineHalfBreadthAt(x: number): number;
  /** Highest point above the waterline, metres (for shadow framing). */
  maxHeight: number;
}
