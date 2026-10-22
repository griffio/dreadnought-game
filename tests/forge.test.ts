import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { deckHeight, halfBreadthAt, waterlineHalfBreadth } from '../src/render/ships/forge/hull';
import { MATERIAL, MeshBuilder } from '../src/render/ships/forge/mesh-builder';
import { MAX_NODES, ShipRig } from '../src/render/ships/rig';

const model = buildShip(DREADNOUGHT);
const f = new Float32Array(model.vertices);
const u = new Uint32Array(model.vertices);

const vertex = (i: number) => ({
  p: [f[i * 8]!, f[i * 8 + 1]!, f[i * 8 + 2]!] as const,
  n: [f[i * 8 + 3]!, f[i * 8 + 4]!, f[i * 8 + 5]!] as const,
  node: u[i * 8 + 6]! & 0xff,
  material: (u[i * 8 + 6]! >> 8) & 0xff,
  aux: u[i * 8 + 7]!,
});

describe('MeshBuilder primitives', () => {
  it('a box has 24 flat vertices with axis-aligned unit normals and valid indices', () => {
    const b = new MeshBuilder();
    b.box(0, 0, 0, 2, 4, 6);
    expect(b.vertexCount).toBe(24);
    expect(b.indices.length).toBe(36);
    for (let i = 0; i < b.vertexCount; i++) {
      const n = [b.normals[i * 3]!, b.normals[i * 3 + 1]!, b.normals[i * 3 + 2]!];
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      expect(n.filter((c) => Math.abs(c) > 0.99).length).toBe(1);
    }
    expect(Math.max(...b.indices)).toBeLessThan(b.vertexCount);
  });

  it('box faces point away from the centre', () => {
    const b = new MeshBuilder();
    b.box(5, 1, -2, 2, 2, 2);
    for (let i = 0; i < b.vertexCount; i++) {
      const out =
        (b.positions[i * 3]! - 5) * b.normals[i * 3]! +
        (b.positions[i * 3 + 1]! - 1) * b.normals[i * 3 + 1]! +
        (b.positions[i * 3 + 2]! + 2) * b.normals[i * 3 + 2]!;
      expect(out).toBeGreaterThan(0.9);
    }
  });

  it('lathe normals point away from the axis for a cylinder', () => {
    const b = new MeshBuilder();
    b.lathe([[0, 1], [3, 1]], 16);
    for (let i = 0; i < b.vertexCount; i++) {
      const y = b.positions[i * 3 + 1]!;
      const z = b.positions[i * 3 + 2]!;
      const radial = y * b.normals[i * 3 + 1]! + z * b.normals[i * 3 + 2]!;
      expect(radial).toBeGreaterThan(0.99);
    }
  });

  it('the transform stack places and then restores geometry', () => {
    const b = new MeshBuilder();
    b.within((m) => m.translate(10, 0, 0), () => b.box(0, 0, 0, 2, 2, 2));
    b.box(0, 0, 0, 2, 2, 2);
    const xs = Array.from({ length: b.vertexCount }, (_, i) => b.positions[i * 3]!);
    expect(Math.max(...xs.slice(0, 24))).toBeCloseTo(11, 5);
    expect(Math.max(...xs.slice(24))).toBeCloseTo(1, 5);
  });

  it('carries the node, material and aux payload per vertex', () => {
    const b = new MeshBuilder();
    b.node = 7;
    b.material = MATERIAL.FUNNEL;
    b.auxValue = 205;
    b.box(0, 0, 0, 1, 1, 1);
    const packed = b.pack();
    const v = new Uint32Array(packed.vertices);
    expect(v[6]! & 0xff).toBe(7);
    expect((v[6]! >> 8) & 0xff).toBe(MATERIAL.FUNNEL);
    expect(v[7]).toBe(205);
  });
});

describe('hull shape functions', () => {
  const h = DREADNOUGHT.hull;

  it('closes to a point at both ends and is widest amidships', () => {
    expect(waterlineHalfBreadth(h, 0)).toBe(0);
    expect(waterlineHalfBreadth(h, 1)).toBe(0);
    expect(waterlineHalfBreadth(h, 0.4)).toBeCloseTo(h.beam / 2, 6);
  });

  it('has the sheer the spec asks for', () => {
    expect(deckHeight(h, 0.5)).toBeCloseTo(h.deckMid, 6);
    expect(deckHeight(h, 1)).toBeCloseTo(h.deckBow, 6);
    expect(deckHeight(h, 0)).toBeCloseTo(h.deckStern, 6);
  });

  it('narrows below the waterline and flares above it near the bow', () => {
    expect(halfBreadthAt(h, 0.4, -h.draft * 0.9)).toBeLessThan(halfBreadthAt(h, 0.4, -1));
    expect(halfBreadthAt(h, 0.9, deckHeight(h, 0.9))).toBeGreaterThan(waterlineHalfBreadth(h, 0.9));
  });
});

describe('Dreadnought model', () => {
  it('is a modest, valid mesh', () => {
    expect(model.vertexCount).toBeGreaterThan(5000);
    expect(model.vertexCount).toBeLessThan(80000);
    expect(model.indices.length % 3).toBe(0);
    for (const i of model.indices) expect(i).toBeLessThan(model.vertexCount);
  });

  it('has finite positions and unit-length normals everywhere', () => {
    for (let i = 0; i < model.vertexCount; i++) {
      const { p, n } = vertex(i);
      for (const c of [...p, ...n]) expect(Number.isFinite(c)).toBe(true);
      expect(Math.hypot(...n)).toBeCloseTo(1, 3);
    }
  });

  it('fits the published dimensions', () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let maxZ = 0;
    let minY = Infinity;
    for (let i = 0; i < model.vertexCount; i++) {
      const { p, material } = vertex(i);
      if (material !== MATERIAL.HULL && material !== MATERIAL.DECK) continue;
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      maxZ = Math.max(maxZ, Math.abs(p[2]));
      minY = Math.min(minY, p[1]);
    }
    expect(maxX - minX).toBeGreaterThan(160.6);
    expect(maxX - minX).toBeLessThan(160.6 + 6);
    expect(maxZ).toBeGreaterThan(12.4);
    expect(maxZ).toBeLessThan(12.5 * 1.2);
    expect(minY).toBeCloseTo(-8.1, 1);
  });

  it('hull side normals point outward and deck normals point up', () => {
    let sides = 0;
    let decks = 0;
    for (let i = 0; i < model.vertexCount; i++) {
      const { p, n, material } = vertex(i);
      if (material === MATERIAL.HULL && Math.abs(p[2]) > 8 && p[1] > -2 && p[1] < 3 && Math.abs(p[0]) < 40) {
        sides++;
        expect(n[2] * Math.sign(p[2])).toBeGreaterThan(0.5);
      }
      if (material === MATERIAL.DECK && Math.abs(p[0]) < 60) {
        decks++;
        expect(n[1]).toBeGreaterThan(0.8);
      }
    }
    expect(sides).toBeGreaterThan(100);
    expect(decks).toBeGreaterThan(100);
  });

  it('five twin 12-inch turrets with the right layout', () => {
    const heavy = model.turrets.filter((t) => t.boreMm === 305);
    expect(heavy.map((t) => t.id)).toEqual(['A', 'P', 'Q', 'X', 'Y']);
    for (const t of heavy) {
      expect(t.barrelNodes).toHaveLength(2);
    }
    // ...and ten 12-pounders, each a single gun that trains.
    const light = model.turrets.filter((t) => t.boreMm === 76);
    expect(light).toHaveLength(10);
    for (const t of light) expect(t.barrelNodes).toHaveLength(1);
    const byId = Object.fromEntries(model.turrets.map((t) => [t.id, t]));
    expect(byId.P!.axis[2]).toBeLessThan(0); // port wing
    expect(byId.Q!.axis[2]).toBeGreaterThan(0); // starboard wing
    expect(byId.A!.axis[0]).toBeGreaterThan(40);
    expect(byId.Y!.axis[0]).toBeLessThan(-40);
  });

  it('funnel vertices carry their top height for the shader', () => {
    const funnelAux = new Set<number>();
    for (let i = 0; i < model.vertexCount; i++) {
      const v = vertex(i);
      if (v.material === MATERIAL.FUNNEL && v.aux > 0) funnelAux.add(v.aux);
    }
    expect(funnelAux.size).toBe(2);
    for (const a of funnelAux) expect(a / 10).toBeGreaterThan(15);
  });

  it('fits the node table', () => {
    expect(model.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    model.nodes.forEach((n, i) => expect(n.parent).toBeLessThan(i));
  });
});

describe('ShipRig', () => {
  const muzzle = (rig: ShipRig, id: string, gun: number): [number, number, number] => {
    const t = rig.turret(id);
    const m = rig.matrices.subarray(t.barrelNodes[gun]! * 16, t.barrelNodes[gun]! * 16 + 16);
    const p = t.trunnions[gun]!;
    const q: [number, number, number] = [p[0] + t.muzzleOffset[0], p[1] + t.muzzleOffset[1], p[2] + t.muzzleOffset[2]];
    return [
      m[0]! * q[0] + m[4]! * q[1] + m[8]! * q[2] + m[12]!,
      m[1]! * q[0] + m[5]! * q[1] + m[9]! * q[2] + m[13]!,
      m[2]! * q[0] + m[6]! * q[1] + m[10]! * q[2] + m[14]!,
    ];
  };

  it('rests with turret A pointing ahead and Y pointing aft', () => {
    const rig = new ShipRig(model);
    const a = muzzle(rig, 'A', 0);
    const aT = rig.turret('A').trunnions[0]!;
    expect(a[0]).toBeGreaterThan(aT[0] + 11);
    const y = muzzle(rig, 'Y', 0);
    const yT = rig.turret('Y').trunnions[0]!;
    expect(y[0]).toBeLessThan(yT[0]);
  });

  it('training 90 degrees swings the muzzle to starboard about the turret axis', () => {
    const rig = new ShipRig(model);
    rig.setTurret('A', Math.PI / 2, 0);
    rig.update();
    const t = rig.turret('A');
    const m = muzzle(rig, 'A', 0);
    const dx = t.trunnions[0]![0] + t.muzzleOffset[0] - t.axis[0];
    const dz = t.trunnions[0]![2] - t.axis[2];
    // new = axis + dx*(cos, sin) + dz*(-sin, cos) with psi = 90 deg
    expect(m[0]).toBeCloseTo(t.axis[0] - dz, 4);
    expect(m[2]).toBeCloseTo(t.axis[2] + dx, 4);
    expect(m[2] - t.axis[2]).toBeGreaterThan(10); // out to starboard
  });

  it('elevation raises the muzzle by L sin(theta) and clamps to the gun limits', () => {
    const rig = new ShipRig(model);
    rig.setTurret('A', 0, 10 * (Math.PI / 180));
    rig.update();
    const t = rig.turret('A');
    const m = muzzle(rig, 'A', 0);
    expect(m[1] - t.trunnions[0]![1]).toBeCloseTo(t.muzzleOffset[0] * Math.sin(10 * (Math.PI / 180)), 3);
    rig.setTurret('A', 0, 80 * (Math.PI / 180));
    rig.update();
    const high = muzzle(rig, 'A', 0);
    expect(high[1] - t.trunnions[0]![1]).toBeCloseTo(t.muzzleOffset[0] * Math.sin(t.maxElevDeg * (Math.PI / 180)), 3);
  });

  it('recoil slides one barrel back along its own axis only', () => {
    const rig = new ShipRig(model);
    const before = [muzzle(rig, 'A', 0), muzzle(rig, 'A', 1)];
    rig.setRecoil('A', 0, 1.1);
    rig.update();
    const after = [muzzle(rig, 'A', 0), muzzle(rig, 'A', 1)];
    expect(after[0]![0]).toBeCloseTo(before[0]![0] - 1.1, 4);
    expect(after[1]).toEqual(before[1]);
  });
});
