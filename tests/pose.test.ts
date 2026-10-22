import { describe, expect, it } from 'vitest';
import { cross, dot } from '../src/math/vec3';
import { shipBasis, shipModelMatrix, type ShipPose } from '../src/render/ships/pose-matrix';
import { sunShadowMatrix } from '../src/render/ships/shadow-map';

const level = (headingDeg: number): ShipPose => ({ x: 0, z: 0, headingDeg, heave: 0, pitch: 0, roll: 0 });

const close = (a: readonly number[], b: readonly number[], digits = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe('shipBasis', () => {
  it('faces compass directions: 0 = north (-z), 90 = east (+x)', () => {
    close(shipBasis(level(0)).forward, [0, 0, -1]);
    close(shipBasis(level(90)).forward, [1, 0, 0]);
    close(shipBasis(level(180)).forward, [0, 0, 1]);
  });

  it('starboard is to the right of the heading and up is up', () => {
    close(shipBasis(level(0)).starboard, [1, 0, 0]); // heading north: east is to starboard
    close(shipBasis(level(90)).starboard, [0, 0, 1]); // heading east: south is to starboard
    close(shipBasis(level(0)).up, [0, 1, 0]);
  });

  it('is orthonormal and right-handed (forward x up = starboard) under pitch and roll', () => {
    const b = shipBasis({ ...level(37), pitch: 0.1, roll: -0.2 });
    expect(dot(b.forward, b.forward)).toBeCloseTo(1, 6);
    expect(dot(b.up, b.up)).toBeCloseTo(1, 6);
    expect(dot(b.starboard, b.starboard)).toBeCloseTo(1, 6);
    expect(dot(b.forward, b.up)).toBeCloseTo(0, 6);
    expect(dot(b.forward, b.starboard)).toBeCloseTo(0, 6);
    close(cross(b.forward, b.up), b.starboard);
  });

  it('positive pitch raises the bow; positive roll lowers the starboard side', () => {
    expect(shipBasis({ ...level(0), pitch: 0.1 }).forward[1]).toBeGreaterThan(0.09);
    expect(shipBasis({ ...level(0), roll: 0.1 }).starboard[1]).toBeLessThan(-0.09);
  });
});

describe('shipModelMatrix', () => {
  it('places the ship relative to the camera in float64 first', () => {
    const m = shipModelMatrix({ ...level(0), x: 20000.5, z: -30000.25, heave: 1.5 }, [20000, 20, -30000], new Float32Array(16));
    close([m[12]!, m[13]!, m[14]!], [0.5, -18.5, -0.25]);
  });

  it('maps ship-space +x to the heading direction', () => {
    const m = shipModelMatrix(level(90), [0, 0, 0], new Float32Array(16));
    // column 0 is the image of ship +x
    close([m[0]!, m[1]!, m[2]!], [1, 0, 0]);
  });
});

describe('sunShadowMatrix', () => {
  const sun: [number, number, number] = [0.3, 0.5, -0.8];
  const apply = (m: Float32Array, p: [number, number, number]) => {
    const v = [0, 1, 2, 3].map((r) => m[0 * 4 + r]! * p[0] + m[1 * 4 + r]! * p[1] + m[2 * 4 + r]! * p[2] + m[3 * 4 + r]!);
    return [v[0]! / v[3]!, v[1]! / v[3]!, v[2]! / v[3]!];
  };

  it('maps the focus point near the middle of the map', () => {
    const m = new Float32Array(16);
    const cam: [number, number, number] = [123.4, 30, -87.6];
    const focus: [number, number, number] = [200, 5, 40];
    sunShadowMatrix(sun, focus, cam, 150, 200, 4096, m);
    const [x, y, z] = apply(m, [focus[0] - cam[0], focus[1] - cam[1], focus[2] - cam[2]]);
    expect(Math.abs(x!)).toBeLessThan(0.01); // within a texel or two of centre
    expect(Math.abs(y!)).toBeLessThan(0.01);
    expect(z).toBeCloseTo(0.5, 2);
  });

  it('puts points toward the sun at smaller depth than points away from it', () => {
    const m = new Float32Array(16);
    sunShadowMatrix(sun, [0, 0, 0], [0, 0, 0], 150, 200, 4096, m);
    const towardSun = apply(m, [sun[0] * 50, sun[1] * 50, sun[2] * 50]);
    const awayFromSun = apply(m, [-sun[0] * 50, -sun[1] * 50, -sun[2] * 50]);
    expect(towardSun[2]!).toBeLessThan(awayFromSun[2]!);
  });

  it('spans -1..1 across the map half-extent', () => {
    const m = new Float32Array(16);
    // Sun almost overhead: the light-space x axis is world z, y is world x.
    sunShadowMatrix([0, 1, 0.0001], [0, 0, 0], [0, 0, 0], 100, 100, 2048, m);
    const a = apply(m, [0, 0, 100]);
    const b = apply(m, [0, 0, -100]);
    expect(Math.abs(a[0]! - b[0]!)).toBeCloseTo(2, 1);
    const c = apply(m, [100, 0, 0]);
    const d = apply(m, [-100, 0, 0]);
    expect(Math.abs(c[1]! - d[1]!)).toBeCloseTo(2, 1);
  });

  it('snaps to whole texels: sub-texel focus movement leaves the map alone', () => {
    const texel = 300 / 4096;
    const steps = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const m = new Float32Array(16);
      sunShadowMatrix(sun, [100 + i * 0.001, 0, 0], [0, 0, 0], 150, 200, 4096, m);
      steps.add(`${m[12]!.toFixed(6)},${m[13]!.toFixed(6)}`);
    }
    // 0.1 m of motion spans at most two texel boundaries per axis; unsnapped it would be 100 values.
    expect(0.1 / texel).toBeLessThan(2);
    expect(steps.size).toBeLessThanOrEqual(4);
  });
});
