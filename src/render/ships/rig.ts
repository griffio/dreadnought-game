import { identityMat4, mulMat4, rotationYMat4, rotationZMat4, translationMat4, type Mat4 } from '../../math/mat4';
import type { NodeDef, ShipModel, TurretRef } from './forge/spec';

const DEG = Math.PI / 180;

/** Articulation of one node: train about the vertical axis, elevation about the trunnion, recoil slide. */
export interface NodePose {
  /** Radians, positive toward starboard (clockwise from above). */
  train: number;
  /** Radians, positive raises the muzzle. */
  elevation: number;
  /** Metres along the barrel; negative is recoil. */
  slide: number;
}

export const MAX_NODES = 96;

/**
 * Pose state for a model's nodes and the matrix hierarchy. Geometry is authored in ship space, so each
 * node's local transform is  T(pivot) * R * T(slide) * T(-pivot, undone), composed down from the root.
 */
export class ShipRig {
  readonly poses: NodePose[];
  /** Node-to-ship matrices, column-major, one per node (what the shader's node table holds). */
  readonly matrices = new Float32Array(MAX_NODES * 16);
  private readonly turretsById = new Map<string, TurretRef>();
  private readonly local: Mat4[];
  private readonly world: Mat4[];
  private readonly scratchA = new Float32Array(16);
  private readonly scratchB = new Float32Array(16);
  private readonly scratchC = new Float32Array(16);

  constructor(readonly model: ShipModel) {
    if (model.nodes.length > MAX_NODES) throw new Error(`model has ${model.nodes.length} nodes; max ${MAX_NODES}`);
    this.poses = model.nodes.map(() => ({ train: 0, elevation: 0, slide: 0 }));
    this.local = model.nodes.map(() => identityMat4(new Float32Array(16)));
    this.world = model.nodes.map(() => identityMat4(new Float32Array(16)));
    for (const t of model.turrets) {
      this.turretsById.set(t.id, t);
      this.poses[t.houseNode]!.train = t.restTrainDeg * DEG;
    }
    this.update();
  }

  turret(id: string): TurretRef {
    const t = this.turretsById.get(id);
    if (!t) throw new Error(`no turret ${id}`);
    return t;
  }

  /** Train the house (radians from dead ahead, + starboard) and elevate every barrel together. */
  setTurret(id: string, train: number, elevation: number): void {
    const t = this.turret(id);
    this.poses[t.houseNode]!.train = train;
    const clamped = Math.min(Math.max(elevation, t.minElevDeg * DEG), t.maxElevDeg * DEG);
    for (const n of t.barrelNodes) this.poses[n]!.elevation = clamped;
  }

  setRecoil(id: string, gun: number, metres: number): void {
    const n = this.turret(id).barrelNodes[gun];
    if (n !== undefined) this.poses[n]!.slide = -Math.abs(metres);
  }

  /** Recompute all node matrices from the current poses. */
  update(): void {
    const nodes: readonly NodeDef[] = this.model.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const pose = this.poses[i]!;
      const [px, py, pz] = node.pivot;
      // local = T(p) * Ry(-train) * Rz(elev) * T(slide) * T(-p)
      const toPivot = translationMat4(px, py, pz, this.scratchA);
      const train = rotationYMat4(-pose.train, this.scratchB);
      const out = this.local[i]!;
      let m = mulMat4(toPivot, train, this.scratchC);
      const elev = rotationZMat4(pose.elevation, this.scratchA);
      m = mulMat4(m, elev, this.scratchB);
      const slide = translationMat4(pose.slide, 0, 0, this.scratchA);
      m = mulMat4(m, slide, this.scratchC);
      const back = translationMat4(-px, -py, -pz, this.scratchA);
      mulMat4(m, back, out);

      if (node.parent < 0) this.world[i]!.set(out);
      else mulMat4(this.world[node.parent]!, out, this.world[i]!);
      this.matrices.set(this.world[i]!, i * 16);
    }
  }
}
