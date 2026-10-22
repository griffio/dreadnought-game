import { describe, expect, it } from 'vitest';
import { exposureStops, sunlightAt, transmittanceToTop } from '../src/render/sky/atmosphere-cpu';

describe('transmittance', () => {
  it('is nearly clear with the sun overhead, and bluer light is attenuated more', () => {
    const [r, g, b] = sunlightAt(0, 90);
    expect(r).toBeGreaterThan(0.85);
    expect(g).toBeGreaterThan(0.75);
    expect(b).toBeGreaterThan(0.55);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('reddens and dims as the sun nears the horizon', () => {
    const noon = sunlightAt(0, 60);
    const golden = sunlightAt(0, 5);
    const grazing = sunlightAt(0, 0.5);
    expect(golden[0]).toBeLessThan(noon[0]);
    expect(golden[2] / golden[0]).toBeLessThan(noon[2] / noon[0]);
    expect(grazing[2] / grazing[0]).toBeLessThan(golden[2] / golden[0]);
    expect(grazing[0]).toBeLessThan(golden[0]);
  });

  it('is zero once the sun is below the horizon (the planet blocks it)', () => {
    expect(sunlightAt(0, -3)).toEqual([0, 0, 0]);
  });

  it('higher altitude sees less atmosphere', () => {
    const sea = sunlightAt(0, 10);
    const cloud = sunlightAt(1800, 10);
    expect(cloud[2]).toBeGreaterThan(sea[2]);
  });

  it('stays within [0, 1]', () => {
    for (const mu of [-0.1, 0, 0.05, 0.5, 1]) {
      for (const c of transmittanceToTop(6360.5, mu)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('exposureStops', () => {
  it('is zero in daylight and grows monotonically toward night', () => {
    expect(exposureStops(60)).toBe(0);
    let last = -1;
    for (const e of [30, 10, 3, 0, -2, -5, -9, -14]) {
      const v = exposureStops(e);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});
