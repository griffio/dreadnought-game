import { describe, expect, it } from 'vitest';
import { ROSTER, type ShipId } from '../src/data/ships/roster';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { MATERIAL } from '../src/render/ships/forge/mesh-builder';
import { firstIndexAbove, sortTriangles } from '../src/render/ships/triangles';

const SHEETS = new Set<number>([MATERIAL.HULL, MATERIAL.DECK]);

/** A buffer of vertices at the given heights and materials, in the Forge's layout (8 words each: y at word 1, the material in word 6). */
function vertices(ys: number[], materials: number[] = ys.map(() => MATERIAL.SUPERSTRUCTURE)): ArrayBuffer {
  const buffer = new ArrayBuffer(ys.length * 32);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  ys.forEach((y, i) => {
    f[i * 8 + 1] = y;
    u[i * 8 + 6] = (materials[i]! & 0xff) << 8;
  });
  return buffer;
}

describe('a ship’s triangles in two runs', () => {
  it('put the sheets (hull, decks) first and then the works by the height of their highest corner', () => {
    // Four triangles: works topping out at 5 and 20 and 2, and a hull sheet at 8.
    const v = vertices([0, 5, 1, 10, 20, 3, 0, 1, 2, 4, 8, 2], [6, 6, 6, 6, 6, 6, 6, 6, 6, MATERIAL.HULL, MATERIAL.HULL, MATERIAL.HULL]);
    const { indices, worksStart, maxY } = sortTriangles(v, Uint32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), SHEETS);
    expect(worksStart).toBe(3);
    expect(Array.from(indices)).toEqual([9, 10, 11, 6, 7, 8, 0, 1, 2, 3, 4, 5]);
    expect(Array.from(maxY)).toEqual([2, 5, 20]);
  });

  it('keep triangles whole, and in their own order when they are level', () => {
    const v = vertices([4, 4, 4, 4, 4, 4]);
    const { indices } = sortTriangles(v, Uint32Array.of(0, 1, 2, 3, 4, 5, 2, 3, 4), SHEETS);
    expect(Array.from(indices)).toEqual([0, 1, 2, 3, 4, 5, 2, 3, 4]);
  });

  it('have no sheets in a ship that has none, and nothing but sheets in a bare hull', () => {
    const works = sortTriangles(vertices([1, 2, 3]), Uint32Array.of(0, 1, 2), SHEETS);
    expect(works.worksStart).toBe(0);
    const hull = sortTriangles(vertices([1, 2, 3], [0, 0, 0]), Uint32Array.of(0, 1, 2), SHEETS);
    expect(hull.worksStart).toBe(3);
    expect(hull.maxY).toHaveLength(0);
  });

  it('say where the run of works above a height begins', () => {
    const maxY = Float32Array.of(2, 5, 5, 9, 20);
    expect(firstIndexAbove(maxY, -1)).toBe(0);
    expect(firstIndexAbove(maxY, 2)).toBe(3);
    expect(firstIndexAbove(maxY, 5)).toBe(9);
    expect(firstIndexAbove(maxY, 8.9)).toBe(9);
    expect(firstIndexAbove(maxY, 9)).toBe(12);
    expect(firstIndexAbove(maxY, 20)).toBe(15);
    expect(firstIndexAbove(maxY, Number.POSITIVE_INFINITY)).toBe(15);
    expect(firstIndexAbove(new Float32Array(0), 3)).toBe(0);
  });

  const ids = Object.keys(ROSTER) as ShipId[];
  const key = (a: Uint32Array) => {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 3) out.push(`${a[i]},${a[i + 1]},${a[i + 2]}`);
    return out.sort();
  };

  it('keep every real ship’s triangles, each once, with the sheets exactly the hull and the decks', () => {
    for (const id of ids) {
      const m = buildShip(ROSTER[id].spec);
      const { indices, worksStart } = sortTriangles(m.vertices, m.indices, SHEETS);
      expect(key(indices), id).toEqual(key(m.indices));
      const material = (tri: number) => (new Uint32Array(m.vertices)[indices[tri * 3]! * 8 + 6]! >> 8) & 0xff;
      for (let t = 0; t < indices.length / 3; t++) expect(SHEETS.has(material(t)), `${id} ${t}`).toBe(t < worksStart / 3);
    }
  });

  it('keep the hull and decks out of reach of the sight’s lens, so that they never need the pipeline that discards', () => {
    // The lens sits at the director's height (a default for the ships that have none) and the cutaway reaches 14 m from it.
    const REACH = 14;
    for (const id of ids) {
      const m = buildShip(ROSTER[id].spec);
      const { indices, worksStart, maxY } = sortTriangles(m.vertices, m.indices, SHEETS);
      const f = new Float32Array(m.vertices);
      let sheetTop = 0;
      for (let i = 0; i < worksStart; i++) sheetTop = Math.max(sheetTop, f[indices[i]! * 8 + 1]!);
      const lens = ROSTER[id].setup.director?.[1] ?? 25;
      expect(sheetTop, id).toBeLessThan(lens - REACH);
      // And the works that can reach it are the high part of them, not all.
      const reach = (maxY.length * 3 - firstIndexAbove(maxY, lens - REACH - 1)) / 3;
      expect(reach / maxY.length, id).toBeLessThan(0.75);
    }
  });
});
