import { describe, expect, it } from 'vitest';
import { mulMat4, reverseZProjection, viewFromBasis } from '../src/math/mat4';

function transform(m: Float32Array, v: [number, number, number, number]): [number, number, number, number] {
  const row = (r: number) => v.reduce((sum, x, c) => sum + m[c * 4 + r]! * x, 0);
  return [row(0), row(1), row(2), row(3)];
}

describe('reverseZProjection', () => {
  const proj = reverseZProjection(Math.PI / 3, 16 / 9, 0.3, new Float32Array(16));

  it('maps the near plane to depth 1 and distant points toward 0', () => {
    const [, , zn, wn] = transform(proj, [0, 0, -0.3, 1]);
    expect(zn / wn).toBeCloseTo(1, 5);
    const [, , zf, wf] = transform(proj, [0, 0, -40000, 1]);
    expect(zf / wf).toBeGreaterThan(0);
    expect(zf / wf).toBeLessThan(1e-4);
  });

  it('keeps depth strictly ordered across tens of kilometres', () => {
    let last = Infinity;
    for (const d of [1, 10, 100, 1000, 10000, 40000]) {
      const [, , z, w] = transform(proj, [0, 0, -d, 1]);
      expect(z / w).toBeLessThan(last);
      last = z / w;
    }
  });

  it('puts a point on the view axis at the centre of the screen', () => {
    const [x, y, , w] = transform(proj, [0, 0, -50, 1]);
    expect(x / w).toBeCloseTo(0, 6);
    expect(y / w).toBeCloseTo(0, 6);
  });
});

describe('viewFromBasis', () => {
  it('sends the camera forward axis to -z and right to +x', () => {
    const right: [number, number, number] = [1, 0, 0];
    const up: [number, number, number] = [0, 1, 0];
    const forward: [number, number, number] = [0, 0, -1];
    const view = viewFromBasis(right, up, forward, new Float32Array(16));
    expect(transform(view, [0, 0, -5, 1]).slice(0, 3)).toEqual([0, 0, -5]);
    expect(transform(view, [2, 0, 0, 1]).slice(0, 3)).toEqual([2, 0, 0]);
  });

  it('rotates a yawed camera so its forward becomes -z', () => {
    const yaw = Math.PI / 2; // looking along +x
    const forward: [number, number, number] = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const right: [number, number, number] = [Math.cos(yaw), 0, Math.sin(yaw)];
    const view = viewFromBasis(right, [0, 1, 0], forward, new Float32Array(16));
    const [x, y, z] = transform(view, [10, 0, 0, 1]);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(-10, 5);
  });
});

describe('mulMat4', () => {
  it('multiplies in column-major order', () => {
    const a = new Float32Array(16);
    const b = new Float32Array(16);
    a.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]); // translate x by 5
    b.set([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]); // scale by 2
    const ab = mulMat4(a, b, new Float32Array(16));
    expect(transform(ab, [1, 1, 1, 1]).slice(0, 3)).toEqual([7, 2, 2]); // scale then translate
  });
});
