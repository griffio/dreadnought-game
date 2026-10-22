import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { dazzleFactor } from '../src/sim/gunnery/dazzle';
import { CALM } from '../src/sim/gunnery/ballistics';
import { Gunnery, type Contact } from '../src/sim/gunnery/gunnery';
import { GUN_12_45_MK_X } from '../src/sim/gunnery/guns';
import { mountsFromModel } from '../src/sim/gunnery/mounts';
import { RANGEFINDER_9FT } from '../src/sim/gunnery/rangefinder';
import { Rng } from '../src/sim/rng';
import type { ShipFrame } from '../src/sim/ships/frame';

const DEG = Math.PI / 180;
const KNOT = 0.514444;
const mounts = mountsFromModel(buildShip(DREADNOUGHT)).filter((m) => ['A', 'P', 'Q', 'X', 'Y'].includes(m.id));
const FRAME: ShipFrame = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0 };

describe('dazzle paint', () => {
  it('does nothing at close range, and more the further off she is', () => {
    expect(dazzleFactor(1, 0)).toEqual({ range: 1, bearing: 1 });
    expect(dazzleFactor(1, 2500)).toEqual({ range: 1, bearing: 1 });
    const mid = dazzleFactor(1, 6000);
    const far = dazzleFactor(1, 12000);
    expect(mid.range).toBeGreaterThan(1.1);
    expect(far.range).toBeGreaterThan(mid.range);
    expect(far.range).toBeCloseTo(1.35, 6);
    expect(far.bearing).toBeCloseTo(1.6, 6);
    // Further than that it does not grow.
    expect(dazzleFactor(1, 40000).range).toBeCloseTo(far.range, 9);
  });

  it('is nothing for a ship without it, and in proportion otherwise', () => {
    expect(dazzleFactor(0, 12000)).toEqual({ range: 1, bearing: 1 });
    expect(dazzleFactor(0.5, 12000).range).toBeCloseTo(1 + 0.35 * 0.5, 6);
    expect(dazzleFactor(5, 12000).range).toBeCloseTo(1.35, 6);
    expect(dazzleFactor(-1, 12000).range).toBe(1);
  });

  /** How far the plot's estimate of the target's velocity is from the truth, m/s, averaged over the last half minute of a ninety-second plot. */
  function plotError(seed: number, range: number, dazzle: number): number {
    const speed = 12 * KNOT;
    const target: Contact = { id: 2, name: 'T', x: 0, z: -range, vx: speed, vz: 0, heading: 90 * DEG, halfLength: 80, halfBeam: 12.5, draft: 8, height: 16, topHeight: 38, deckHeight: 5.5, dazzle };
    const g = new Gunnery({ gun: GUN_12_45_MK_X, mounts, rng: new Rng(seed), shooterId: 1, env: CALM, rangefinder: RANGEFINDER_9FT, visibilityKm: 40, directorHeight: 24 });
    g.contacts.push(target);
    g.designate(target);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 90 * 60; i++) {
      const t = i / 60;
      target.x += target.vx / 60;
      g.update(1 / 60, t, FRAME, false);
      if (t >= 60 && i % 60 === 0) {
        const est = g.track.estimate(t);
        if (est) {
          sum += Math.hypot(est.vx - target.vx, est.vz - target.vz);
          n++;
        }
      }
    }
    return n > 0 ? sum / n : Number.NaN;
  }

  it('makes the enemy’s estimate of her speed and course worse at long range', () => {
    let plain = 0;
    let dazzled = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    for (const seed of seeds) {
      plain += plotError(seed, 12000, 0);
      dazzled += plotError(seed, 12000, 1);
    }
    expect(Number.isFinite(plain) && Number.isFinite(dazzled)).toBe(true);
    // The rate that the plot fits is the worse for it, by about a third (the range reading is a third worse and the bearing 60% worse).
    expect(dazzled).toBeGreaterThan(plain * 1.2);
    expect(dazzled).toBeLessThan(plain * 1.7);
  }, 60_000);

  it('makes no difference inside three kilometres: the same readings, the same plot', () => {
    for (const seed of [1, 2, 3]) expect(plotError(seed, 2500, 1)).toBe(plotError(seed, 2500, 0));
  });
});
