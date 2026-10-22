import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';

describe('Rng', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const c = new Rng(1235);
    const sa = Array.from({ length: 8 }, () => a.next());
    const sb = Array.from({ length: 8 }, () => b.next());
    const sc = Array.from({ length: 8 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces roughly standard-normal samples', () => {
    const r = new Rng(99);
    const n = 40000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const g = r.gaussian();
      sum += g;
      sumSq += g * g;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeGreaterThan(0.95);
    expect(variance).toBeLessThan(1.05);
  });
});
