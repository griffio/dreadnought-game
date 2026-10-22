import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/sim/time';

const STEP = 1 / 60;

describe('FixedStepper', () => {
  it('runs one step for one step-length of real time', () => {
    const s = new FixedStepper(STEP);
    expect(s.advance(STEP)).toBe(1);
    expect(s.alpha).toBeCloseTo(0, 6);
  });

  it('accumulates sub-step frames and exposes the remainder as alpha', () => {
    const s = new FixedStepper(STEP);
    expect(s.advance(STEP * 0.5)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5, 6);
    expect(s.advance(STEP * 0.75)).toBe(1);
    expect(s.alpha).toBeCloseTo(0.25, 6);
  });

  it('keeps total steps proportional to total time across uneven frames', () => {
    const s = new FixedStepper(STEP);
    let total = 0;
    for (const dt of [0.011, 0.023, 0.017, 0.009, 0.031, 0.016, 0.02]) total += s.advance(dt);
    // 0.127 s / (1/60) = 7.62 steps
    expect(total).toBe(7);
  });

  it('caps steps per frame and drops the backlog instead of spiralling', () => {
    const s = new FixedStepper(STEP, 5, 0.25);
    expect(s.advance(10)).toBe(5); // clamped to 0.25 s = 15 steps of backlog, only 5 run
    expect(s.alpha).toBeLessThan(1);
    expect(s.advance(0)).toBe(0); // backlog was dropped, not carried
  });

  it('ignores negative frame times', () => {
    const s = new FixedStepper(STEP);
    expect(s.advance(-1)).toBe(0);
    expect(s.alpha).toBe(0);
  });
});
