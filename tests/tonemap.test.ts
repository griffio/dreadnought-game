import { describe, expect, it } from 'vitest';
import postWgsl from '../src/render/post/post.wgsl?raw';

// The AgX constants live in WGSL. These tests parse them out and check the maths, because a typo in a
// recalled matrix would silently tint every frame.

type Mat3 = [number[], number[], number[]]; // stored as columns, like the WGSL constructors

function parseMat(name: string): Mat3 {
  const m = new RegExp(`const ${name} = mat3x3<f32>\\(([^;]*?)\\);`, 's').exec(postWgsl);
  if (!m) throw new Error(`matrix ${name} not found in post.wgsl`);
  const nums = (m[1]!.match(/-?\d+\.\d+(?:e-?\d+)?/g) ?? []).map(Number);
  if (nums.length !== 9) throw new Error(`matrix ${name}: expected 9 numbers, got ${nums.length}`);
  return [nums.slice(0, 3), nums.slice(3, 6), nums.slice(6, 9)];
}

const mulVec = (m: Mat3, v: number[]): number[] =>
  [0, 1, 2].map((r) => m[0]![r]! * v[0]! + m[1]![r]! * v[1]! + m[2]![r]! * v[2]!);

const contrast = (x: number): number => {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};

const SRGB_TO_REC2020 = parseMat('SRGB_TO_REC2020');
const REC2020_TO_SRGB = parseMat('REC2020_TO_SRGB');
const INSET = parseMat('AGX_INSET');
const OUTSET = parseMat('AGX_OUTSET');

function agx(rgb: number[]): number[] {
  let c = mulVec(INSET, mulVec(SRGB_TO_REC2020, rgb));
  c = c.map((v) => Math.log2(Math.max(v, 1e-10)));
  c = c.map((v) => Math.min(Math.max((v + 12.47393) / (4.026069 + 12.47393), 0), 1));
  c = c.map(contrast);
  c = mulVec(OUTSET, c).map((v) => Math.max(v, 0) ** 2.2);
  return mulVec(REC2020_TO_SRGB, c).map((v) => Math.min(Math.max(v, 0), 1));
}

const srgbEncode = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

describe('AgX constants', () => {
  it('keeps white white: both colour-space matrices have unit row sums', () => {
    for (const m of [SRGB_TO_REC2020, REC2020_TO_SRGB, INSET, OUTSET]) {
      const white = mulVec(m, [1, 1, 1]);
      for (const c of white) expect(c).toBeCloseTo(1, 3);
    }
  });

  it('colour-space matrices are inverses of each other', () => {
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, 0.6, 0.1]]) {
      const back = mulVec(REC2020_TO_SRGB, mulVec(SRGB_TO_REC2020, v));
      back.forEach((c, i) => expect(c).toBeCloseTo(v[i]!, 2));
    }
  });

  it('outset roughly undoes the inset but is deliberately not its exact inverse', () => {
    // AgX pulls primaries in more on the way into the curve than it pushes them back out, which is what
    // gives bright saturated colours their gentle desaturation. Exact inverses would defeat that.
    let maxDeviation = 0;
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.2, 0.5, 0.9]]) {
      const back = mulVec(OUTSET, mulVec(INSET, v));
      back.forEach((c, i) => {
        const dev = Math.abs(c - v[i]!);
        maxDeviation = Math.max(maxDeviation, dev);
        expect(dev).toBeLessThan(0.15);
      });
    }
    expect(maxDeviation).toBeGreaterThan(0.01);
  });
});

describe('AgX transform', () => {
  it('maps scene-linear mid-grey (0.18) to a display mid-grey', () => {
    const [r, g, b] = agx([0.18, 0.18, 0.18]).map(srgbEncode);
    for (const c of [r!, g!, b!]) {
      expect(c).toBeGreaterThan(0.4);
      expect(c).toBeLessThan(0.62);
    }
    expect(Math.abs(r! - g!)).toBeLessThan(0.02);
  });

  it('is monotonic and keeps black dark and bright highlights bright', () => {
    let last = -1;
    for (const x of [0.0005, 0.01, 0.05, 0.18, 0.5, 1, 4, 16]) {
      const v = agx([x, x, x])[1]!;
      expect(v).toBeGreaterThan(last);
      last = v;
    }
    expect(agx([0, 0, 0])[1]!).toBeLessThan(0.01);
    expect(srgbEncode(agx([16, 16, 16])[1]!)).toBeGreaterThan(0.9);
  });

  it('desaturates very bright saturated colours instead of clipping a channel', () => {
    const [r, g, b] = agx([20, 2, 0.1]);
    expect(r!).toBeLessThanOrEqual(1);
    expect(g!).toBeGreaterThan(0);
    expect(b!).toBeGreaterThanOrEqual(0);
  });
});
