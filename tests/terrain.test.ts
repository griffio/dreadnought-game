import { describe, expect, it } from 'vitest';
import { buildTerrain, type TerrainSpec } from '../src/sim/terrain/generate';
import { chainCoast, EARTH_RADIUS, SHORE, Terrain } from '../src/sim/terrain/terrain';

const spec: TerrainSpec = {
  x0: -3000,
  z0: -3000,
  width: 6000,
  length: 6000,
  cell: 20,
  seabed: 60,
  masses: [{ x: 0, z: 0, rx: 700, rz: 500, peak: 120, rough: 0.3 }],
  banks: [{ x: 1800, z: 0, rx: 400, rz: 400, depth: 6 }],
};

describe('the terrain', () => {
  const t = buildTerrain(spec, 3);

  it('has an island with a summit, a shore and a sea floor that shelves away', () => {
    expect(t.heightAt(0, 0)).toBeGreaterThan(80);
    expect(t.maxHeight).toBeGreaterThan(100);
    expect(t.isLand(0, 0)).toBe(true);
    expect(t.isLand(1500, 1500)).toBe(false);
    // Just off the beach it is shallow, and deepens with distance, to the open depth.
    const near = t.depthAt(720, 0);
    const far = t.depthAt(1300, 0);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(far);
    expect(t.depthAt(2600, 2600)).toBeCloseTo(60, 0);
  });

  it('has a shoal where the water is shallow, and deep water around it', () => {
    expect(t.depthAt(1800, 0)).toBeGreaterThan(4);
    expect(t.depthAt(1800, 0)).toBeLessThan(9);
    expect(t.depthAt(1800, 1200)).toBeGreaterThan(40);
  });

  it('is the same ground for the same seed and different for another', () => {
    const again = buildTerrain(spec, 3);
    expect(again.heightAt(100, 100)).toBe(t.heightAt(100, 100));
    const other = buildTerrain(spec, 4);
    expect(other.heightAt(100, 100)).not.toBe(t.heightAt(100, 100));
  });

  it('beyond the grid is open sea', () => {
    expect(t.heightAt(99999, 0)).toBe(-60);
    expect(t.isLand(-99999, -99999)).toBe(false);
  });

  it('a hill blocks the line of sight between two ships low on the water, and a high eye sees over it', () => {
    // Two points at the waterline, either side of the island.
    expect(t.blocked(-1500, 10, 0, 1500, 10, 0)).toBe(true);
    // Both ends clear of the island: a line past its north end.
    expect(t.blocked(-1500, 10, 1200, 1500, 10, 1200)).toBe(false);
    // From 300 m up (an aircraft) the line to a ship clears a 120 m island; from 100 m it does not.
    expect(t.blocked(-1500, 300, 0, 1500, 20, 0)).toBe(false);
    expect(t.blocked(-1500, 100, 0, 1500, 20, 0)).toBe(true);
  });

  it('the curve of the earth lets a distant hill hide a low target it would not on a flat sea', () => {
    // A 60 m hill 20 km from an eye 30 m up, with the target just beyond it at the waterline.
    const flat = new Terrain({ x0: 0, z0: -100, cell: 100, nx: 400, nz: 3, heights: new Float32Array(400 * 3).fill(-50) });
    for (let ix = 195; ix < 205; ix++) for (let iz = 0; iz < 3; iz++) flat.heights[iz * 400 + ix] = 60;
    // Flat-earth line from (0, 30) to (39000, 5) passes the hill at x=20000 at 30 - 25*0.51 = 17 m: blocked. Use a closer target.
    expect(flat.blocked(0, 30, 0, 39500, 5, 0)).toBe(true);
    // The bulge is real: 39.5 km apart the earth rises (39500^2/8)/6.371e6 = 30 m at the middle.
    expect((39500 * 39500) / (8 * EARTH_RADIUS)).toBeCloseTo(30.6, 0);
  });

  it('a shell strikes the hill it falls on, and flies over one it clears', () => {
    const hit = t.segmentHit(-300, 90, 0, -100, 40, 0);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeGreaterThan(0);
    expect(hit!.y).toBeLessThan(t.maxHeight);
    expect(t.segmentHit(-300, 400, 0, 300, 380, 0)).toBeNull();
    // Over the sea there is no ground to strike.
    expect(t.segmentHit(1500, 30, 1500, 1600, 2, 1500)).toBeNull();
  });

  it('the coast chains into closed lines around the island and the grid edge', () => {
    const lines = chainCoast(t.coast(SHORE));
    // The island is one closed ring.
    const rings = lines.filter((l) => Math.hypot(l[0]![0] - l[l.length - 1]![0], l[0]![1] - l[l.length - 1]![1]) < 2);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const longest = rings.sort((a, b) => b.length - a.length)[0]!;
    // Its points lie close to the 700 x 500 shoreline.
    for (const [x, z] of longest) {
      const r = Math.hypot(x / 700, z / 500);
      expect(r).toBeGreaterThan(0.85);
      expect(r).toBeLessThan(1.1);
    }
  });
});
