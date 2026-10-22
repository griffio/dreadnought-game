import { describe, expect, it } from 'vitest';
import { SMOKE, SmokeField } from '../src/sim/smoke/smoke-field';

describe('smoke', () => {
  it('a clear sea transmits everything', () => {
    expect(new SmokeField().transmission(0, 0, 8000, 0)).toBe(1);
  });

  it('a line of sight through the middle of a cloud is dimmed, one past it is not', () => {
    const f = new SmokeField();
    f.emit(4000, 0);
    expect(f.transmission(0, 0, 8000, 0)).toBeLessThan(0.7);
    expect(f.transmission(0, 200, 8000, 200)).toBe(1);
    // A cloud behind the observer, or beyond the target, does not count.
    expect(f.transmission(0, 0, 3000, 0)).toBe(1);
    expect(f.transmission(5000, 0, 8000, 0)).toBe(1);
  });

  it('a wall of puffs shuts the view, and the sight line past its end stays open', () => {
    const f = new SmokeField();
    for (let i = 0; i < 12; i++) f.emit(4000, -300 + i * 50);
    expect(f.transmission(0, 0, 8000, 0)).toBeLessThan(0.1);
    expect(f.transmission(0, 600, 8000, 600)).toBeGreaterThan(0.95);
  });

  it('the cloud spreads, thins and goes', () => {
    const f = new SmokeField();
    f.emit(0, 0);
    const c = f.clouds[0]!;
    const r0 = c.radius;
    const d0 = c.depth;
    for (let i = 0; i < 60 * 60; i++) f.step(1 / 60);
    expect(c.radius).toBeGreaterThan(r0 * 2);
    expect(c.depth).toBeLessThan(d0 * 0.4);
    for (let i = 0; i < 60 * 200; i++) f.step(1 / 60);
    expect(f.clouds.length).toBe(0);
    expect(SMOKE.life).toBeGreaterThan(60);
  });

  it('the wind carries it', () => {
    const f = new SmokeField();
    f.wind = [8, 0];
    f.emit(0, 0);
    for (let i = 0; i < 60 * 30; i++) f.step(1 / 60);
    expect(f.clouds[0]!.x).toBeGreaterThan(150);
  });
});
