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

/** A small deterministic random sequence from a string, so that a wrecked turret is wrecked the same way every time (and in a replay). */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pose state for a model's nodes and the matrix hierarchy. Geometry is authored in ship space, so each
 * node's local transform is  T(pivot) * R * T(slide) * T(-pivot, undone), composed down from the root.
 */
export class ShipRig {
  readonly poses: NodePose[];
  /** Node-to-ship matrices, column-major, one per node (what the shader's node table holds). */
  readonly matrices = new Float32Array(MAX_NODES * 16);
  /** How charred each node is, 0 (as built) to 1 (burnt black): the shader darkens it and lets embers glow in it. */
  readonly char = new Float32Array(MAX_NODES);
  /** Nodes that have been blown away: their matrix is made nothing, so none of their geometry is drawn. */
  private readonly gone = new Uint8Array(MAX_NODES);
  private readonly wrecked = new Set<string>();
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

  /** Train the house (radians from dead ahead, + starboard) and elevate every barrel together. A wrecked turret does not move. */
  setTurret(id: string, train: number, elevation: number): void {
    if (this.wrecked.has(id)) return;
    const t = this.turret(id);
    this.poses[t.houseNode]!.train = train;
    const clamped = Math.min(Math.max(elevation, t.minElevDeg * DEG), t.maxElevDeg * DEG);
    for (const n of t.barrelNodes) this.poses[n]!.elevation = clamped;
  }

  setRecoil(id: string, gun: number, metres: number): void {
    if (this.wrecked.has(id)) return;
    const n = this.turret(id).barrelNodes[gun];
    if (n !== undefined) this.poses[n]!.slide = -Math.abs(metres);
  }

  isWrecked(id: string): boolean {
    return this.wrecked.has(id);
  }

  /**
   * Wreck a turret: most of its barrels are blown away and the rest droop, the house is left askew where it stood, and all of it is
   * charred. It stays so (and stops training) until `repair` or a replay of an earlier moment puts it back. Unknown ids are ignored.
   */
  wreck(id: string): void {
    const t = this.turretsById.get(id);
    if (!t || this.wrecked.has(id)) return;
    this.wrecked.add(id);
    const rnd = seeded(id);
    // The house is knocked off true, fore or aft.
    this.poses[t.houseNode]!.elevation = (rnd() < 0.5 ? -1 : 1) * (4 + 7 * rnd()) * DEG;
    this.char[t.houseNode] = 0.85;
    t.barrelNodes.forEach((n, i) => {
      this.char[n] = 1;
      this.poses[n]!.slide = 0;
      // At least one barrel is gone, and at least one stays (a stump, drooping).
      const blown = i === 0 ? rnd() < 0.7 : i === t.barrelNodes.length - 1 ? rnd() < 0.4 : rnd() < 0.6;
      this.gone[n] = blown ? 1 : 0;
      // What is left hangs broken at the trunnion, well down from the lowest the gun could be laid.
      this.poses[n]!.elevation = -(14 + 16 * rnd()) * DEG - this.poses[t.houseNode]!.elevation * 0.5;
    });
    if (t.barrelNodes.length > 0 && t.barrelNodes.every((n) => this.gone[n])) this.gone[t.barrelNodes[t.barrelNodes.length - 1]!] = 0;
  }

  /** Put a wrecked turret back as it was built (a replay of a moment before it was hit). */
  repair(id: string): void {
    const t = this.turretsById.get(id);
    if (!t || !this.wrecked.delete(id)) return;
    this.char[t.houseNode] = 0;
    this.poses[t.houseNode]!.elevation = 0;
    for (const n of t.barrelNodes) {
      this.char[n] = 0;
      this.gone[n] = 0;
      this.poses[n]!.elevation = 0;
    }
  }

  /**
   * The turrets' articulation, flattened for a replay: for each turret in the model's order, its train, its elevation and the recoil
   * slide of each barrel. The matrices are not kept: they follow from these.
   */
  snapshot(): Float32Array {
    const turrets = this.model.turrets;
    const out = new Float32Array(turrets.reduce((n, t) => n + 3 + t.barrelNodes.length, 0));
    let o = 0;
    for (const t of turrets) {
      out[o++] = this.poses[t.houseNode]!.train;
      out[o++] = this.poses[t.barrelNodes[0] ?? t.houseNode]!.elevation;
      for (const n of t.barrelNodes) out[o++] = this.poses[n]!.slide;
      out[o++] = this.wrecked.has(t.id) ? 1 : 0;
    }
    return out;
  }

  /** Lay the turrets as a snapshot had them (the matrices are recomputed by the next `update`). */
  restore(a: ArrayLike<number>): void {
    let o = 0;
    for (const t of this.model.turrets) {
      const train = a[o++] ?? 0;
      const elevation = a[o++] ?? 0;
      const slides = t.barrelNodes.map(() => a[o++] ?? 0);
      const wrecked = (a[o++] ?? 0) > 0.5;
      if (wrecked) this.wreck(t.id);
      else this.repair(t.id);
      if (wrecked) continue;
      this.poses[t.houseNode]!.train = train;
      t.barrelNodes.forEach((n, i) => {
        this.poses[n]!.elevation = elevation;
        this.poses[n]!.slide = slides[i]!;
      });
    }
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
      // A node that has been blown away is squashed to a point, so that none of it is drawn (its children are drawn from their own).
      if (this.gone[i]) {
        this.matrices.fill(0, i * 16, i * 16 + 16);
        this.matrices[i * 16 + 15] = 1;
      }
    }
  }
}
