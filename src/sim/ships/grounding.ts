import type { Terrain } from '../terrain/terrain';
import type { ShipDynamics } from './dynamics';

export interface GroundingHull {
  /** Length and beam overall, and the draft at the keel, metres. */
  length: number;
  beam: number;
  draft: number;
}

export interface GroundingResult {
  /** She is stuck fast now (and moving no deeper into the shoal). */
  grounded: boolean;
  /** She has just struck: the speed she was making, m/s; 0 on the steps after. */
  impactSpeed: number;
  /** Ship-space x of the strike, metres from amidships, positive forward. */
  at: number;
}

/** Water the keel needs beyond the draft before she touches, metres. */
export const KEEL_CLEARANCE = 0.4;
/** Water beyond the draft that frees a ship that has been aground, metres. */
const FREE_MARGIN = 1.5;
/** Where the keel is sounded, as fractions of the hull's half-length (x) and half-beam (z): stem, shoulders, amidships, quarters, stern. */
const KEEL_POINTS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, 1],
  [0.5, -1],
  [0, 1],
  [0, -1],
  [0, 0],
  [-0.5, 1],
  [-0.5, -1],
  [-1, 0],
];

/**
 * Running aground. The hull is tested at its ends, its middle and its turn of bilge: if any of them has less water under it than
 * her draft she is on the bottom. A ship does not move into shoaler water than she is in (her way is lost and her position kept),
 * but she can back out into deeper. A strike at speed opens the bottom plates, so `impactSpeed` is reported for the damage model.
 */
export class Grounding {
  grounded = false;
  private lastX = 0;
  private lastZ = 0;

  constructor(
    private readonly terrain: Terrain,
    private readonly hull: GroundingHull,
  ) {}

  /** Water depth under the shallowest point of the hull, with the ship at (x, z, heading), metres. */
  minDepth(x: number, z: number, heading: number): { depth: number; at: number } {
    const sh = Math.sin(heading);
    const ch = Math.cos(heading);
    const L = this.hull.length * 0.46;
    const B = this.hull.beam * 0.4;
    let depth = Number.POSITIVE_INFINITY;
    let at = 0;
    for (const [kx, kz] of KEEL_POINTS) {
      const lx = kx * L;
      const lz = kz * B;
      const wx = x + lx * sh + lz * ch;
      const wz = z - lx * ch + lz * sh;
      const d = this.terrain.depthAt(wx, wz);
      if (d < depth) {
        depth = d;
        at = lx;
      }
    }
    return { depth, at };
  }

  /** Remember where the ship is before her dynamics step. */
  begin(dyn: ShipDynamics): void {
    this.lastX = dyn.x;
    this.lastZ = dyn.z;
  }

  /** After the dynamics have moved her: keep her out of water too shallow for her. */
  resolve(dyn: ShipDynamics, draft: number = this.hull.draft): GroundingResult {
    const need = draft + KEEL_CLEARANCE;
    const here = this.minDepth(dyn.x, dyn.z, dyn.heading);
    const clear = here.depth >= need;

    if (this.grounded) {
      // Once on the bottom she stays there until she is backing off into water with room to spare.
      if (here.depth >= need + FREE_MARGIN || (clear && dyn.speed < -0.05)) {
        this.grounded = false;
        return { grounded: false, impactSpeed: 0, at: 0 };
      }
      const before = this.minDepth(this.lastX, this.lastZ, dyn.heading);
      if (here.depth < before.depth - 1e-6) {
        dyn.x = this.lastX;
        dyn.z = this.lastZ;
      }
      // Whatever way she tries to make ahead is lost on the bottom.
      if (dyn.speed > 0) dyn.speed = 0;
      return { grounded: true, impactSpeed: 0, at: here.at };
    }

    if (clear) return { grounded: false, impactSpeed: 0, at: 0 };
    // She has touched: she stops where she was, with the way on her spent on the bottom.
    const impact = Math.abs(dyn.speed);
    dyn.x = this.lastX;
    dyn.z = this.lastZ;
    dyn.speed = 0;
    this.grounded = true;
    return { grounded: true, impactSpeed: impact, at: here.at };
  }
}
