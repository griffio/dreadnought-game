import { describe, expect, it } from 'vitest';
import { DREADNOUGHT_SETUP, PRE_DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { AGGRESSIVE } from '../src/sim/combat/ai';
import { Duel } from '../src/sim/combat/duel';
import { buoyancyModes, DEFAULT_WAVE_SPEC, OCEAN_LOOP_SECONDS, WaveField } from '../src/sim/ocean/waves';
import { Afloat } from '../src/sim/ships/afloat';
import { battleshipHandling, ShipDynamics } from '../src/sim/ships/dynamics';

describe('the waves a ship floats on', () => {
  it('come from the sea spec alone, the same every time, and loop with the ocean', () => {
    const a = buoyancyModes(DEFAULT_WAVE_SPEC);
    const b = buoyancyModes(DEFAULT_WAVE_SPEC);
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
    const field = new WaveField(a);
    let peak = 0;
    for (let t = 0; t < 60; t += 0.5) peak = Math.max(peak, Math.abs(field.heightAt(300, -200, t)));
    expect(peak).toBeGreaterThan(0.3); // an 11 m/s wind raises waves a ship feels
    expect(field.heightAt(123, 456, 17)).toBeCloseTo(field.heightAt(123, 456, 17 + OCEAN_LOOP_SECONDS), 6);
    // Another seed is another sea.
    expect(buoyancyModes({ ...DEFAULT_WAVE_SPEC, seed: 8 })).not.toEqual(a);
    expect(WaveField.fromSpec()).toBe(WaveField.fromSpec()); // kept once made
  });
});

describe('a hull afloat', () => {
  it('rolls and pitches with the sea, and a broadside shoves it', () => {
    const d = new ShipDynamics(battleshipHandling(160, 21));
    d.heading = 1.2;
    const afloat = new Afloat(160, 25, WaveField.fromSpec());
    let motion = 0;
    for (let t = 0; t < 40; t += 1 / 60) {
      afloat.step(1 / 60, t, d, null, []);
      motion = Math.max(motion, Math.abs(afloat.body.roll) + Math.abs(afloat.body.pitch) + Math.abs(afloat.body.heave));
    }
    expect(motion).toBeGreaterThan(0.005);
    const flat = new Afloat(160, 25, WaveField.flat());
    for (let t = 0; t < 10; t += 1 / 60) flat.step(1 / 60, t, d, null, []);
    expect(flat.frame(d).roll).toBe(0);
    flat.step(1 / 60, 10, d, null, [{ drainKick: () => ({ roll: 0.01, pitch: 0 }) }]);
    for (let t = 10; t < 12; t += 1 / 60) flat.step(1 / 60, t, d, null, []);
    expect(Math.abs(flat.frame(d).roll)).toBeGreaterThan(1e-4);
  });
});

describe('the headless duel', () => {
  const duel = (seed: number, waves?: WaveField) =>
    new Duel({
      seed,
      a: { setup: DREADNOUGHT_SETUP, ai: AGGRESSIVE, x: 0, z: 0, headingDeg: 0 },
      b: { setup: PRE_DREADNOUGHT_SETUP, ai: AGGRESSIVE, x: 3000, z: -9000, headingDeg: 180 },
      waves,
    });

  it('floats its ships on the game\'s sea, the same fight for the same seed', () => {
    const x = duel(5);
    const y = duel(5);
    for (let i = 0; i < 60 * 45; i++) {
      x.step();
      y.step();
    }
    const fx = x.afloat.map((a, i) => a.frame([x.a, x.b][i]!.dynamics));
    const fy = y.afloat.map((a, i) => a.frame([y.a, y.b][i]!.dynamics));
    expect(fx).toEqual(fy);
    expect(fx.some((f) => Math.abs(f.roll) + Math.abs(f.pitch) + Math.abs(f.y) > 0.002)).toBe(true);
    expect([x.a.shellsFired, x.a.hitsTaken, x.b.shellsFired, x.b.hitsTaken]).toEqual([y.a.shellsFired, y.a.hitsTaken, y.b.shellsFired, y.b.hitsTaken]);
  });

  it('can still be fought on flat water', () => {
    const d = duel(5, WaveField.flat());
    for (let i = 0; i < 60 * 20; i++) d.step();
    // Flat water lifts nothing (the guns' recoil still rocks her, so roll and pitch are not zero).
    expect(d.afloat[0]!.frame(d.a.dynamics).y).toBe(0);
  });
});

describe('the closed-form plane fit', () => {
  it('gives the sampled fit, mode for mode, at any heading', async () => {
    const { HullPlaneFit } = await import('../src/sim/ocean/waves');
    const { fitWaterPlane } = await import('../src/sim/ships/buoyancy');
    const { heightFromModes } = await import('../src/sim/ocean/spectrum');
    const field = WaveField.fromSpec();
    const fit = new HullPlaneFit(160.6, 25);
    for (const [heading, t, px, pz] of [
      [0, 3, 0, 0],
      [37, 11.5, 1200, -800],
      [90, 100, -40, 7],
      [222.4, 250, 5000, 5000],
      [359.9, 299, 30, -30],
    ] as const) {
      const fast = fit.planeAt(field, px, pz, heading, t);
      const slow = fitWaterPlane((x, z) => heightFromModes(field.modes, x, z, t), px, pz, heading, 160.6, 25);
      expect(fast.height).toBeCloseTo(slow.height, 9);
      expect(fast.slopeX).toBeCloseTo(slow.slopeX, 9);
      expect(fast.slopeZ).toBeCloseTo(slow.slopeZ, 9);
    }
    // And a single long wave running straight along a hull half its length: the sampled and closed sums agree where the kernel is far from trivial.
    const one = new WaveField([{ kx: (2 * Math.PI) / 80, kz: 0, amplitude: 1, phase: 0.3, omega: 0.9 }]);
    const f2 = new HullPlaneFit(160, 25);
    const a = f2.planeAt(one, 10, 20, 90, 4);
    const b = fitWaterPlane((x, z) => heightFromModes(one.modes, x, z, 4), 10, 20, 90, 160, 25);
    expect(a.height).toBeCloseTo(b.height, 9);
    expect(a.slopeX).toBeCloseTo(b.slopeX, 9);
    expect(a.slopeZ).toBeCloseTo(b.slopeZ, 9);
  });
});
