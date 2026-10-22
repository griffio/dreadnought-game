/**
 * What a ship is made of, for the damage model: how it is armoured, how its hull is divided into watertight compartments
 * and what each holds. The visible model comes from the ShipSpec; this says what a hit on it does.
 */
export type CompartmentRole = 'void' | 'magazine' | 'boiler' | 'engine' | 'steering' | 'bunker';

export interface CompartmentSpec {
  id: string;
  name: string;
  role: CompartmentRole;
  /** Extent along the ship, metres from amidships (positive toward the bow). */
  x0: number;
  x1: number;
  /** Water it holds when flooded solid, tonnes (the volume times how much of it is open to water). */
  capacityT: number;
  /** Men stationed here. */
  crew: number;
  /** Turrets whose ammunition is stowed here (for a magazine). */
  feeds?: string[];
  /** Share of the ship's propulsion this compartment provides (boiler and engine rooms). */
  power?: number;
}

export interface ArmorSpec {
  /** Waterline belt: the armoured strip along the hull side, and what is left toward the ends. Thickness in mm. */
  belt: { x0: number; x1: number; mm: number; endsMm: number };
  /** The hull side above the belt (upper belt or casemate armour). */
  upperSide: { x0: number; x1: number; mm: number };
  deck: { x0: number; x1: number; mm: number };
  /** Unarmoured plating: the hull outside the armoured zones, bulkheads and light structure. */
  plating: number;
  turretFace: number;
  turretSide: number;
  turretRoof: number;
  barbette: number;
  conning: number;
  /** Armour of the small mounts (casemate guns, 200 mm bore and under), if the ship has any. */
  light?: { face: number; side: number; roof: number; barbette: number };
}

export interface DamageSpec {
  displacementT: number;
  /** Metacentric height, metres: how stiff the ship is against heeling. */
  gm: number;
  /** Water the ship can take aboard before it goes down by the head, tonnes. */
  reserveT: number;
  pumpTonnesPerSecond: number;
  /** Damage-control parties, each able to fight one fire or plug one hole at a time. */
  parties: number;
  /** How much of a magazine's flash risk the ship's flash protection removes (0 none, 1 all). */
  flashProtection: number;
  /** Anti-torpedo bulges and bulkheads: 0 none, 1 would stop a torpedo outright. */
  torpedoProtection?: number;
  /** How much more a burst hurts her than a ship of the reference size: the blast is a larger share of a small hull. Default 1. */
  fragility?: number;
  /** Water the damage-control party can let into the high side's opposite side to right a list, tonnes. Default 1500. */
  counterFloodT?: number;
  armor: ArmorSpec;
  compartments: CompartmentSpec[];
}
