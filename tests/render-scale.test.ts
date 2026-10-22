import { describe, expect, it } from 'vitest';
import { RenderScaleController } from '../src/render/render-scale';

function run(c: RenderScaleController, frameMs: number, seconds: number): number[] {
  const trace: number[] = [];
  for (let t = 0; t < seconds; t += frameMs / 1000) {
    const r = c.sample(frameMs, frameMs / 1000);
    if (r !== null) trace.push(r);
  }
  return trace;
}

/** A GPU whose frame time is `base` ms at full resolution, scaling with pixel count, vsync-locked at 16.7 ms. */
function simulate(c: RenderScaleController, baseMs: number, seconds: number): void {
  for (let t = 0; t < seconds; ) {
    const cost = baseMs * c.scale * c.scale;
    const frameMs = Math.max(16.7, cost);
    c.sample(frameMs, frameMs / 1000);
    t += frameMs / 1000;
  }
}

describe('RenderScaleController', () => {
  it('reduces resolution when frames are too slow, proportionally to the overrun', () => {
    const c = new RenderScaleController(0.5, 1, 1, 15);
    run(c, 30, 1.2); // twice the budget: sqrt(15/30) = 0.71, limited to a 0.75 step
    expect(c.scale).toBeLessThan(0.85);
    expect(c.scale).toBeGreaterThanOrEqual(0.5);
  });

  it('never goes below the minimum', () => {
    const c = new RenderScaleController(0.6, 1, 1, 15);
    run(c, 200, 30);
    expect(c.scale).toBe(0.6);
  });

  it('recovers resolution on a display faster than the target, up to the maximum', () => {
    const c = new RenderScaleController(0.5, 1, 0.6, 15);
    run(c, 6, 40);
    expect(c.scale).toBe(1);
  });

  it('holds steady while frames are slightly under budget with nothing to gain', () => {
    const c = new RenderScaleController(0.5, 1, 1, 15);
    expect(run(c, 16.7, 20)).toEqual([]);
    expect(c.scale).toBe(1);
  });

  it('is not fooled by a GPU that is fine: it never reduces resolution at a steady 60 Hz', () => {
    // The failure that motivated this design: a measurement that looks overloaded while frames hold 60 fps.
    const c = new RenderScaleController(0.5, 1, 1, 15);
    run(c, 16.7, 60);
    expect(c.scale).toBe(1);
    expect(c.changes).toBe(0);
  });

  it('probes upward on a vsync-locked display and climbs back to full resolution when frames hold', () => {
    const c = new RenderScaleController(0.5, 1, 0.5, 15);
    run(c, 16.7, 120);
    expect(c.scale).toBe(1);
  });

  it('finds the highest scale that holds 60 fps and stays near it without thrashing', () => {
    // 28 ms at full resolution: only scale <= sqrt(16.7/28) = 0.77 holds 60 fps.
    const c = new RenderScaleController(0.5, 1, 1, 15);
    simulate(c, 28, 240);
    expect(c.scale).toBeGreaterThan(0.65);
    expect(c.scale).toBeLessThanOrEqual(0.8);
    expect(c.changes).toBeLessThan(26);
  });

  it('recovers to full resolution after a load spike passes', () => {
    const c = new RenderScaleController(0.5, 1, 1, 15);
    simulate(c, 40, 30); // heavy scene
    expect(c.scale).toBeLessThan(0.8);
    simulate(c, 10, 240); // light scene: everything fits
    expect(c.scale).toBe(1);
  });

  it('backs off a probe that costs frame rate, and probes less often afterwards', () => {
    const c = new RenderScaleController(0.5, 1, 0.7, 15);
    for (let t = 0; t < 200; t += 0.0167) {
      const frameMs = c.scale > 0.75 ? 26 : 16.7;
      c.sample(frameMs, 0.0167);
    }
    expect(c.scale).toBeLessThanOrEqual(0.75);
    expect(c.scale).toBeGreaterThanOrEqual(0.65);
    expect(c.changes).toBeLessThan(30);
  });

  it('waits after a change before changing again', () => {
    const c = new RenderScaleController(0.3, 1, 1, 15);
    const changeFrames: number[] = [];
    for (let i = 0; i < 400; i++) {
      if (c.sample(40, 0.04) !== null) changeFrames.push(i);
    }
    for (let i = 1; i < changeFrames.length; i++) expect(changeFrames[i]! - changeFrames[i - 1]!).toBeGreaterThanOrEqual(50);
  });
});
