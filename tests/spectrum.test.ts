import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import {
  cascadeBands,
  compassToWaveDir,
  dominantModes,
  expectedVariance,
  generateH0,
  GRAVITY,
  heightFromModes,
  jonswapOmega,
  omegaQuantised,
  packSpectrum,
  peakOmega,
  spreading,
  type SpectrumParams,
} from '../src/sim/ocean/spectrum';

const params: SpectrumParams = { windSpeed: 12, waveDirRad: 0, fetchM: 100_000, gamma: 3.3 };

describe('compassToWaveDir', () => {
  it('maps compass headings onto the (x, z) plane with north = -z', () => {
    expect(compassToWaveDir(90)).toBeCloseTo(0, 6); // east = +x
    expect(compassToWaveDir(0)).toBeCloseTo(-Math.PI / 2, 6); // north = -z
    expect(Math.abs(compassToWaveDir(180))).toBeCloseTo(Math.PI / 2, 6); // south = +z
  });
});

describe('spreading', () => {
  it('integrates to 1 over the circle', () => {
    for (const s of [2, 8, 20]) {
      const steps = 20000;
      let sum = 0;
      for (let i = 0; i < steps; i++) sum += spreading(-Math.PI + ((i + 0.5) * 2 * Math.PI) / steps, s);
      expect((sum * 2 * Math.PI) / steps).toBeCloseTo(1, 3);
    }
  });
});

describe('JONSWAP', () => {
  it('peaks at the peak frequency', () => {
    const wp = peakOmega(params);
    const at = jonswapOmega(wp, params);
    expect(at).toBeGreaterThan(jonswapOmega(wp * 0.7, params));
    expect(at).toBeGreaterThan(jonswapOmega(wp * 1.5, params));
  });

  it('gives a plausible sea state for 12 m/s over a 100 km fetch (Hs of a couple of metres)', () => {
    const n = 256;
    const bands = cascadeBands(n, [600, 121, 25.3]);
    const variance = bands.reduce((s, b) => s + expectedVariance(n, b, params), 0);
    const hs = 4 * Math.sqrt(variance);
    expect(hs).toBeGreaterThan(1.2);
    expect(hs).toBeLessThan(3.2);
  });
});

describe('cascadeBands', () => {
  it('are contiguous and disjoint, ending below the last cascade Nyquist', () => {
    const bands = cascadeBands(256, [600, 121, 25.3]);
    expect(bands[0]!.kMin).toBe(0);
    expect(bands[1]!.kMin).toBe(bands[0]!.kMax);
    expect(bands[2]!.kMin).toBe(bands[1]!.kMax);
    expect(bands[2]!.kMax).toBeLessThan((Math.PI * 256) / 25.3);
  });
});

describe('generateH0', () => {
  const n = 64;
  const band = cascadeBands(n, [300, 60])[0]!;

  it('is deterministic for a seed', () => {
    const a = generateH0(n, band, params, new Rng(5));
    const b = generateH0(n, band, params, new Rng(5));
    expect(Array.from(a.slice(0, 64))).toEqual(Array.from(b.slice(0, 64)));
  });

  it('realised variance matches the analytic expectation within sampling noise', () => {
    const h0 = generateH0(n, band, params, new Rng(11));
    let realised = 0;
    for (let i = 0; i < h0.length; i += 2) realised += 2 * (h0[i]! ** 2 + h0[i + 1]! ** 2);
    const expected = expectedVariance(n, band, params);
    expect(realised / expected).toBeGreaterThan(0.8);
    expect(realised / expected).toBeLessThan(1.25);
  });

  it('leaves the unpaired Nyquist row and column empty', () => {
    const h0 = generateH0(n, band, params, new Rng(3));
    for (let i = 0; i < n; i++) {
      expect(h0[(0 * n + i) * 2]).toBe(0);
      expect(h0[(i * n + 0) * 2]).toBe(0);
    }
  });

  it('puts the energy on waves travelling roughly along the wave direction', () => {
    const h0 = generateH0(n, band, params, new Rng(21));
    const dk = (2 * Math.PI) / band.lengthM;
    let along = 0;
    let against = 0;
    for (let iz = 1; iz < n; iz++) {
      for (let ix = 1; ix < n; ix++) {
        const i = (iz * n + ix) * 2;
        const e = h0[i]! ** 2 + h0[i + 1]! ** 2;
        const kx = (ix - n / 2) * dk;
        if (kx > 0) along += e;
        else against += e;
      }
    }
    expect(along).toBeGreaterThan(20 * against);
  });
});

describe('packSpectrum + dominantModes', () => {
  it('stores conj(h0(-k)) so h~(-k) = conj(h~(k)) holds at t = 0', () => {
    const n = 16;
    const band = { lengthM: 100, kMin: 0, kMax: 100 };
    const h0 = generateH0(n, band, params, new Rng(8));
    const packed = packSpectrum(h0, n);
    const h = (ix: number, iz: number): [number, number] => {
      const o = (iz * n + ix) * 4;
      return [packed[o]! + packed[o + 2]!, packed[o + 1]! + packed[o + 3]!];
    };
    for (let iz = 1; iz < n; iz++) {
      for (let ix = 1; ix < n; ix++) {
        const [re, im] = h(ix, iz);
        const [mre, mim] = h(n - ix, n - iz);
        expect(mre).toBeCloseTo(re, 6);
        expect(mim).toBeCloseTo(-im, 6);
      }
    }
  });

  it('travelling-wave modes reproduce the direct DFT of h~(k,t) (sign and direction conventions)', () => {
    const n = 16;
    const lengthM = 120;
    const band = { lengthM, kMin: 0, kMax: 100 };
    const w0 = (2 * Math.PI) / 300;
    const h0 = generateH0(n, band, params, new Rng(42));
    const packed = packSpectrum(h0, n);
    const dk = (2 * Math.PI) / lengthM;
    const t = 37.5;

    // Direct inverse DFT of h~(k,t) = h0 e^{-iwt} + conj(h0(-k)) e^{+iwt}.
    const direct = (x: number, z: number): number => {
      let sum = 0;
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          const o = (iz * n + ix) * 4;
          const kx = (ix - n / 2) * dk;
          const kz = (iz - n / 2) * dk;
          const k = Math.hypot(kx, kz);
          if (k === 0) continue;
          const w = omegaQuantised(k, w0);
          const c = Math.cos(w * t);
          const s = Math.sin(w * t);
          // h0 * (c - i s) + hm * (c + i s)
          const re = packed[o]! * c + packed[o + 1]! * s + packed[o + 2]! * c - packed[o + 3]! * s;
          const im = packed[o + 1]! * c - packed[o]! * s + packed[o + 3]! * c + packed[o + 2]! * s;
          const phase = kx * x + kz * z;
          sum += re * Math.cos(phase) - im * Math.sin(phase);
        }
      }
      return sum;
    };

    const modes = dominantModes(h0, n, band, w0, n * n);
    for (const [x, z] of [
      [0, 0],
      [13.7, -4.2],
      [55, 80],
    ] as const) {
      expect(heightFromModes(modes, x, z, t)).toBeCloseTo(direct(x, z), 4);
    }
  });

  it('a single +k mode travels toward +k', () => {
    const modes = [{ kx: 0.2, kz: 0, amplitude: 1, phase: 0, omega: Math.sqrt(GRAVITY * 0.2) }];
    // Crest at x = 0 when t = 0 moves to x = omega/k * t > 0.
    const t = 1;
    const speed = modes[0]!.omega / 0.2;
    expect(heightFromModes(modes, speed * t, 0, t)).toBeCloseTo(1, 6);
    expect(heightFromModes(modes, -speed * t, 0, t)).toBeLessThan(1);
  });
});
