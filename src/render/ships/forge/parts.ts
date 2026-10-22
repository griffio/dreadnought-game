import { deckHeightAtX, type HullSpec } from './hull';
import { MATERIAL, type MeshBuilder, type V3 } from './mesh-builder';
import type { BlockSpec, FunnelSpec, MastSpec, NodeDef, TurretRef, TurretSpec } from './spec';

const DEG = Math.PI / 180;

/** Registry of animation nodes; parents must be added before children. */
export class NodeTable {
  readonly nodes: NodeDef[] = [{ name: 'hull', parent: -1, pivot: [0, 0, 0] }];

  add(name: string, parent: number, pivot: V3): number {
    this.nodes.push({ name, parent, pivot });
    return this.nodes.length - 1;
  }
}

/** A twin/triple/quad turret: a static barbette, a training house, and one elevating node per barrel. */
export function addTurret(b: MeshBuilder, nodes: NodeTable, hull: HullSpec, t: TurretSpec): TurretRef {
  const deckY = deckHeightAtX(hull, t.x);
  const topY = deckY + t.barbetteHeight;

  // Barbette: fixed under the house, part of the hull node.
  b.node = 0;
  b.material = MATERIAL.TURRET;
  b.within(
    (m) => m.translate(t.x, deckY - 0.3, t.z).rotateZ(Math.PI / 2),
    () =>
      b.lathe(
        [
          [0, t.barbetteRadius],
          [t.barbetteHeight + 0.3, t.barbetteRadius],
        ],
        32,
        { capEnd: true },
      ),
  );

  const axis: V3 = [t.x, deckY, t.z];
  const house = nodes.add(`turret-${t.id}`, 0, axis);
  b.node = house;
  b.material = MATERIAL.TURRET;
  const { rear, front, width, height, slope } = t.house;
  b.within(
    (m) => m.translate(t.x, topY, t.z),
    () => {
      b.extrude(
        [
          [-rear, 0],
          [front, 0],
          [front - slope, height],
          [-rear, height],
        ],
        -width / 2,
        width / 2,
      );
      // Sighting hoods on the roof, rear corners.
      b.material = MATERIAL.SUPERSTRUCTURE;
      for (const s of [-1, 1]) b.box(-rear + 1.3, height + 0.35, s * width * 0.3, 1.5, 0.7, 1.1);
      // Gun ports: dark recesses on the sloped face.
      b.material = MATERIAL.BLACK;
      for (let g = 0; g < t.guns; g++) {
        const gz = (g - (t.guns - 1) / 2) * t.gunSpacing;
        b.box(front - slope * 0.45 + 0.04, height * 0.42, gz, 0.1, 1.5, 1.5);
      }
    },
  );

  // Light guns on the roof train with the house.
  for (let i = 0; i < (t.roofGuns ?? 0); i++) {
    const z = ((i + 0.5) / (t.roofGuns ?? 1) - 0.5) * width * 0.7;
    addLightGun(b, [t.x + front * 0.1, topY + height, t.z + z], 0);
  }

  // Barrels: one node each, pivoting at its trunnion, authored in ship space around that point.
  const barrelNodes: number[] = [];
  const trunnions: V3[] = [];
  const r0 = (t.boreMm / 1000) * 0.62;
  const barrelProfile: [number, number][] = [
    [-1.4, r0 * 0.8],
    [-1.2, r0 * 1.1],
    [0, r0 * 1.1],
    [0.8, r0],
    [t.barrelLength * 0.45, r0 * 0.78],
    [t.barrelLength * 0.85, r0 * 0.62],
    [t.barrelLength - 0.35, r0 * 0.58],
    [t.barrelLength - 0.3, r0 * 0.68],
    [t.barrelLength, r0 * 0.68],
    [t.barrelLength, r0 * 0.5],
  ];
  for (let g = 0; g < t.guns; g++) {
    const gz = (g - (t.guns - 1) / 2) * t.gunSpacing;
    const trunnion: V3 = [t.x + 1.0, topY + height * 0.42, t.z + gz];
    const node = nodes.add(`gun-${t.id}${g + 1}`, house, trunnion);
    barrelNodes.push(node);
    trunnions.push(trunnion);
    b.node = node;
    b.material = MATERIAL.GUN;
    b.within(
      (m) => m.translate(trunnion[0], trunnion[1], trunnion[2]),
      () => b.lathe(barrelProfile, 14, { capStart: true, capEnd: true }),
    );
  }

  return {
    id: t.id,
    houseNode: house,
    barrelNodes,
    restTrainDeg: t.restTrainDeg,
    axis,
    trunnions,
    muzzleOffset: [t.barrelLength, 0, 0],
    minElevDeg: t.minElevDeg,
    maxElevDeg: t.maxElevDeg,
    trainMinDeg: t.trainArcDeg?.[0] ?? -180,
    trainMaxDeg: t.trainArcDeg?.[1] ?? 180,
    boreMm: t.boreMm,
    guns: t.guns,
    gunSpacing: t.gunSpacing,
    house: { cx: t.x + (front - rear) / 2, cz: t.z, width, length: rear + front, sideY: topY + height * 0.5, roofY: topY + height },
  };
}

/** Small quick-firing gun on a pedestal with a shield. */
export function addLightGun(b: MeshBuilder, p: V3, trainDeg: number): void {
  b.within(
    (m) => m.translate(p[0], p[1], p[2]).rotateY((-trainDeg * Math.PI) / 180),
    () => {
      b.material = MATERIAL.GUN;
      b.lathe(
        [
          [0, 0.1],
          [0.55, 0.1],
        ],
        8,
        { capEnd: false },
      );
      b.within(
        (m) => m.translate(0, 0.55, 0).rotateZ(4 * DEG),
        () => b.lathe([[-0.2, 0.06], [2.2, 0.045]], 8, { capEnd: true }),
      );
      b.material = MATERIAL.SUPERSTRUCTURE;
      b.box(0.15, 0.6, 0, 0.08, 0.7, 0.9);
    },
  );
}

export function addFunnel(b: MeshBuilder, hull: HullSpec, f: FunnelSpec): void {
  const baseY = deckHeightAtX(hull, f.x) - 0.2;
  const z = f.z ?? 0;
  const topY = baseY + f.height;
  b.node = 0;
  b.material = MATERIAL.FUNNEL;
  b.auxValue = Math.round(topY * 10);
  b.within(
    (m) => m.translate(f.x, baseY, z).rotateZ(Math.PI / 2),
    () =>
      b.lathe(
        [
          [0, 1],
          [f.height - 0.45, 1 - f.taper],
          [f.height - 0.2, 1 - f.taper + 0.02],
          [f.height, 1 - f.taper + 0.02],
        ],
        28,
        { ex: f.halfLength, ez: f.halfWidth, capStart: false, capEnd: false },
      ),
  );
  // The shader paints the black cap band from the top height carried in aux.
  b.auxValue = 0;
  b.material = MATERIAL.BLACK;
  b.within(
    (m) => m.translate(f.x, topY - 0.05, z).rotateZ(Math.PI / 2),
    () =>
      b.lathe(
        [
          [0, 1 - f.taper - 0.14],
          [0.08, 1 - f.taper - 0.14],
        ],
        28,
        { ex: f.halfLength, ez: f.halfWidth, capEnd: true },
      ),
  );
  // Steam pipes up the aft face.
  b.material = MATERIAL.FUNNEL;
  for (const dz of [-0.35, 0.35]) {
    b.tube(
      [f.x - f.halfLength * 0.98, baseY + 1.5, z + dz * f.halfWidth],
      [f.x - f.halfLength * (1 - f.taper) * 0.98, topY - 0.9, z + dz * f.halfWidth],
      0.14,
      0.12,
      8,
    );
  }
}

/** Superstructure block with real window geometry (small dark boxes) on the chosen faces. */
export function addBlock(b: MeshBuilder, hull: HullSpec, bl: BlockSpec): void {
  const deckY = deckHeightAtX(hull, bl.x);
  const y0 = deckY + (bl.lift ?? 0);
  const z = bl.z ?? 0;
  b.node = 0;
  b.material = MATERIAL.SUPERSTRUCTURE;
  b.box(bl.x, y0 + bl.height / 2, z, bl.length, bl.height, bl.width);
  // Roof coaming.
  b.box(bl.x, y0 + bl.height + 0.12, z, bl.length - 0.3, 0.24, bl.width - 0.3);

  if (bl.windows === 'none') return;
  b.material = MATERIAL.BLACK;
  const wy = y0 + bl.height * 0.58;
  const place = (px: number, pz: number, alongX: boolean) =>
    alongX ? b.box(px, wy, pz, 0.8, 0.6, 0.06) : b.box(px, wy, pz, 0.06, 0.6, 0.8);
  // Faces perpendicular to the ship axis (front/back) and, optionally, the sides.
  for (let zz = -bl.width / 2 + 1.0; zz < bl.width / 2 - 0.5; zz += 1.6) {
    place(bl.x + bl.length / 2 + 0.02, z + zz, false);
  }
  if (bl.windows === 'all') {
    for (let xx = -bl.length / 2 + 1.0; xx < bl.length / 2 - 0.5; xx += 1.6) {
      place(bl.x + xx, z + bl.width / 2 + 0.02, true);
      place(bl.x + xx, z - bl.width / 2 - 0.02, true);
    }
    for (let zz = -bl.width / 2 + 1.0; zz < bl.width / 2 - 0.5; zz += 1.6) {
      place(bl.x - bl.length / 2 - 0.02, z + zz, false);
    }
  }
}

export function addConning(b: MeshBuilder, hull: HullSpec, c: { x: number; radius: number; height: number; lift: number }): void {
  const y0 = deckHeightAtX(hull, c.x) + c.lift;
  b.node = 0;
  b.material = MATERIAL.TURRET;
  b.within(
    (m) => m.translate(c.x, y0, 0).rotateZ(Math.PI / 2),
    () =>
      b.lathe(
        [
          [0, c.radius],
          [c.height, c.radius * 0.94],
        ],
        20,
        { capEnd: true },
      ),
  );
  b.material = MATERIAL.BLACK;
  // Vision slits.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(c.x + Math.cos(a) * (c.radius * 0.97), y0 + c.height * 0.62, Math.sin(a) * (c.radius * 0.97), 0.12, 0.14, 0.5);
  }
}

export function addMast(b: MeshBuilder, hull: HullSpec, m: MastSpec): void {
  b.node = 0;
  b.material = MATERIAL.MAST;
  const legs = m.legs.map(([x, z]) => [x, deckHeightAtX(hull, x) - 0.2, z] as V3);
  const baseY = Math.max(...legs.map((l) => l[1]));
  const platY = baseY + m.height;
  const apex: [number, number, number] = [
    legs.reduce((s, l) => s + l[0], 0) / legs.length + (m.kind === 'tripod' ? -0.6 : 0),
    platY,
    0,
  ];

  if (m.kind === 'tripod') {
    for (const l of legs) b.tube(l, [apex[0], platY - 0.5, 0], 0.42, 0.24, 10);
    // Cross bracing between the legs at two heights.
    for (const f of m.platforms ?? [0.35, 0.65]) {
      const y = baseY + m.height * f;
      const pts = legs.map((l): V3 => {
        const t = (y - l[1]) / (platY - 0.5 - l[1]);
        return [l[0] + (apex[0] - l[0]) * t, y, l[2] * (1 - t)];
      });
      for (let i = 0; i < pts.length; i++) b.tube(pts[i]!, pts[(i + 1) % pts.length]!, 0.09, 0.09, 6);
    }
  } else {
    const l = legs[0]!;
    b.tube(l, [l[0], platY, l[2]], 0.5, 0.2, 12);
    apex[0] = l[0];
    apex[2] = l[2];
  }

  // Top platform (the spotting top / crow's nest) with rangefinder hood.
  b.material = MATERIAL.SUPERSTRUCTURE;
  b.within(
    (mm) => mm.translate(apex[0], platY - 0.1, apex[2]).rotateZ(Math.PI / 2),
    () =>
      b.lathe(
        [
          [-0.4, m.platformRadius * 0.7],
          [0, m.platformRadius],
          [0.9, m.platformRadius * 0.95],
          [1.0, m.platformRadius * 0.8],
        ],
        14,
        { capEnd: true, capStart: true },
      ),
  );
  b.box(apex[0] - 0.4, platY + 1.25, apex[2], 2.2, 0.9, 1.4);

  // Topmast, yard and gaff.
  b.material = MATERIAL.MAST;
  const topY = platY + m.topmast;
  b.tube([apex[0], platY + 1.0, apex[2]], [apex[0], topY, apex[2]], 0.17, 0.05, 8);
  b.tube([apex[0], platY + m.topmast * 0.55, apex[2] - 4.5], [apex[0], platY + m.topmast * 0.55, apex[2] + 4.5], 0.06, 0.06, 6);
  b.tube([apex[0], platY + m.topmast * 0.78, apex[2]], [apex[0] - 3.8, platY + m.topmast * 0.5, apex[2]], 0.05, 0.05, 6);
}

/** Where the gaff of a mast ends, aft and a little down from the topmast: where the battle ensign is hoisted. */
export function mastGaffEnd(hull: HullSpec, m: MastSpec): V3 {
  const legs = m.legs.map(([x, z]) => [x, deckHeightAtX(hull, x) - 0.2, z] as V3);
  const baseY = Math.max(...legs.map((l) => l[1]));
  const platY = baseY + m.height;
  const apexX = m.kind === 'tripod' ? legs.reduce((s, l) => s + l[0], 0) / legs.length - 0.6 : legs[0]![0];
  const apexZ = m.kind === 'tripod' ? 0 : legs[0]![2];
  return [apexX - 3.8, platY + m.topmast * 0.5, apexZ];
}

/**
 * A flag: a strip of cloth hung from `(x, y, z)` and streaming aft (-x) for `length` metres, twice as long as it is high. Its node
 * pivots at the hoist, so the rig can swing it to stream along the wind; the vertex shader makes it ripple. Each vertex carries its
 * place on the cloth in `aux` (along from the hoist in the low byte, up from the bottom in the next), for the pattern.
 */
export function addFlag(b: MeshBuilder, nodes: NodeTable, id: string, x: number, y: number, z: number, length: number): number {
  const node = nodes.add(`flag-${id}`, 0, [x, y, z]);
  b.node = node;
  b.material = MATERIAL.FLAG;
  const height = length / 2;
  const nu = 10;
  const nv = 4;
  const first = b.vertexCount;
  for (let j = 0; j <= nv; j++) {
    const v = 1 - j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      b.auxValue = Math.round(u * 255) | (Math.round(v * 255) << 8);
      b.vertex([x - u * length, y - (1 - v) * height, z], [0, 0, 1]);
    }
  }
  b.auxValue = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = first + j * (nu + 1) + i;
      b.triangle(a, a + 1, a + nu + 1);
      b.triangle(a + 1, a + nu + 2, a + nu + 1);
    }
  }
  b.node = 0;
  return node;
}

export function addBoat(b: MeshBuilder, hull: HullSpec, p: { x: number; z: number; length: number }): void {
  const y0 = deckHeightAtX(hull, p.x) + 3.2; // boats ride on the boat deck / skids
  const L = p.length;
  b.node = 0;
  b.material = MATERIAL.WOOD;
  b.within(
    (m) => m.translate(p.x, y0, p.z),
    () => {
      b.extrude(
        [
          [-L / 2, 0.35],
          [-L * 0.36, 0],
          [L * 0.36, 0],
          [L / 2, 0.45],
          [L / 2 - 0.1, 1.05],
          [-L / 2 + 0.1, 0.95],
        ],
        -0.95,
        0.95,
      );
    },
  );
}

export function addVent(b: MeshBuilder, hull: HullSpec, p: { x: number; z: number }): void {
  const y0 = deckHeightAtX(hull, p.x);
  b.node = 0;
  b.material = MATERIAL.BLACK;
  b.within(
    (m) => m.translate(p.x, y0, p.z).rotateZ(Math.PI / 2),
    () =>
      b.lathe(
        [
          [0, 0.3],
          [1.2, 0.28],
          [1.4, 0.34],
          [1.75, 0.62],
          [2.1, 0.66],
          [2.15, 0.5],
        ],
        12,
        { capEnd: true },
      ),
  );
}

export function addSearchlight(b: MeshBuilder, hull: HullSpec, p: { x: number; z: number; lift: number }): void {
  const y0 = deckHeightAtX(hull, p.x) + p.lift;
  b.node = 0;
  b.material = MATERIAL.BLACK;
  b.tube([p.x, y0, p.z], [p.x, y0 + 0.6, p.z], 0.12, 0.12, 6);
  b.material = MATERIAL.BRASS;
  b.tube([p.x - 0.3, y0 + 0.9, p.z], [p.x + 0.55, y0 + 0.9, p.z], 0.42, 0.42, 12, true);
}

export function addStaff(b: MeshBuilder, hull: HullSpec, s: { x: number; height: number }): void {
  const y0 = deckHeightAtX(hull, s.x);
  b.node = 0;
  b.material = MATERIAL.WOOD;
  b.tube([s.x, y0, 0], [s.x, y0 + s.height, 0], 0.07, 0.04, 6);
}
