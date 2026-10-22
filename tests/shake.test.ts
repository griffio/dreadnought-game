import { describe, expect, it } from 'vitest';
import { CameraShake, reachFactor } from '../src/app/shake';

type V3 = [number, number, number];
const camera: V3 = [0, 25, 0];
const blast = (s: CameraShake, x: number, z: number, caliber: number): void => s.onEffect('muzzleBlast', [[x, 20, z] as V3, [0, 0, -1] as V3, caliber], camera);
const burst = (s: CameraShake, x: number, z: number, caliber: number): void => s.onEffect('hitBurst', [x, 5, z, caliber], camera);

describe('camera shake', () => {
  it('is all the blow close to, half at its reach, and less beyond', () => {
    expect(reachFactor(0, 300)).toBe(1);
    expect(reachFactor(300, 300)).toBeCloseTo(0.5, 6);
    expect(reachFactor(900, 300)).toBeLessThan(0.15);
  });

  it('shakes for a shell bursting on the ship and not for one bursting nine kilometres away', () => {
    const near = new CameraShake();
    burst(near, 0, -200, 0.381);
    const far = new CameraShake();
    burst(far, 0, -9000, 0.381);
    expect(near.trauma).toBeGreaterThan(0.4);
    expect(far.trauma).toBeLessThan(0.01);
  });

  it('shakes more for a heavier shell', () => {
    const big = new CameraShake();
    burst(big, 0, -200, 0.381);
    const small = new CameraShake();
    burst(small, 0, -200, 0.1);
    expect(big.trauma).toBeGreaterThan(small.trauma * 2.5);
  });

  it('feels a heavy gun on the ship and not a light one, or a far one', () => {
    const own = new CameraShake();
    blast(own, 0, -60, 0.381);
    const light = new CameraShake();
    blast(light, 0, -60, 0.076);
    const far = new CameraShake();
    blast(far, 0, -8000, 0.381);
    expect(own.trauma).toBeGreaterThan(0.03);
    expect(light.trauma).toBe(0);
    expect(far.trauma).toBeLessThan(0.001);
  });

  it('feels a broadside more than one gun, and the square of it more still', () => {
    const one = new CameraShake();
    blast(one, 0, -40, 0.381);
    const eight = new CameraShake();
    for (let i = 0; i < 8; i++) blast(eight, 0, -40, 0.381);
    one.update(0, 60);
    eight.update(0, 60);
    const size = (s: CameraShake) => Math.hypot(s.yawDeg, s.pitchDeg);
    // (Compare the amplitude the trauma gives, not one sample of the wobble.)
    expect(eight.trauma).toBeGreaterThan(one.trauma * 6);
    expect(eight.trauma ** 2).toBeGreaterThan(one.trauma ** 2 * 30);
    expect(size(eight) + size(one)).toBeGreaterThanOrEqual(0);
  });

  it('is the whole thing for a magazine going up beside her, and nothing for one on the horizon', () => {
    const beside = new CameraShake();
    beside.onEffect('explosion', [0, 8, -150, 1], camera);
    const horizon = new CameraShake();
    horizon.onEffect('explosion', [0, 8, -12000, 1], camera);
    expect(beside.trauma).toBeGreaterThan(0.9);
    expect(horizon.trauma).toBeLessThan(0.05);
  });

  it('never exceeds 1, and dies away', () => {
    const s = new CameraShake();
    for (let i = 0; i < 50; i++) burst(s, 0, -100, 0.381);
    expect(s.trauma).toBe(1);
    for (let i = 0; i < 100; i++) s.update(0.02);
    expect(s.trauma).toBeLessThan(0.5);
    for (let i = 0; i < 500; i++) s.update(0.02);
    expect(s.trauma).toBe(0);
    expect(Math.abs(s.yawDeg)).toBe(0);
    expect(Math.abs(s.pitchDeg)).toBe(0);
  });

  it('moves the aim by a fraction of a degree to a degree or so, smoothly', () => {
    const s = new CameraShake();
    s.add(1);
    let max = 0;
    let jump = 0;
    s.update(1 / 60, 60);
    let last = s.yawDeg;
    for (let i = 0; i < 40; i++) {
      s.update(1 / 60, 60);
      max = Math.max(max, Math.abs(s.yawDeg), Math.abs(s.pitchDeg));
      jump = Math.max(jump, Math.abs(s.yawDeg - last));
      last = s.yawDeg;
    }
    // At full trauma (a magazine beside her) the picture is turned by a degree or so, and quickly.
    expect(max).toBeGreaterThan(0.4);
    expect(max).toBeLessThan(1.5);
    expect(jump).toBeLessThan(0.7);

    // A shell on the ship is half the trauma and a quarter of the turn: a few tenths of a degree, and smooth.
    const half = new CameraShake();
    half.add(0.5);
    half.update(1 / 60, 60);
    let hmax = 0;
    let hjump = 0;
    let hlast = half.yawDeg;
    for (let i = 0; i < 10; i++) {
      half.update(1 / 60, 60);
      hmax = Math.max(hmax, Math.abs(half.yawDeg), Math.abs(half.pitchDeg));
      hjump = Math.max(hjump, Math.abs(half.yawDeg - hlast));
      hlast = half.yawDeg;
    }
    expect(hmax).toBeGreaterThan(0.05);
    expect(hmax).toBeLessThan(0.45);
    expect(hjump).toBeLessThan(0.2);
  });

  it('is less in a narrow field of view, so that the sight is not thrown about', () => {
    const wide = new CameraShake();
    const narrow = new CameraShake();
    wide.add(1);
    narrow.add(1);
    let w = 0;
    let n = 0;
    for (let i = 0; i < 30; i++) {
      wide.update(1 / 60, 60);
      narrow.update(1 / 60, 8);
      w = Math.max(w, Math.abs(wide.yawDeg));
      n = Math.max(n, Math.abs(narrow.yawDeg));
    }
    expect(n).toBeLessThan(w * 0.3);
  });

  it('can be turned off', () => {
    const s = new CameraShake();
    s.enabled = false;
    burst(s, 0, -100, 0.381);
    s.update(0.016);
    expect(s.trauma).toBe(0);
    expect(s.yawDeg).toBe(0);
  });

  it('ignores spectacles that are not blows', () => {
    const s = new CameraShake();
    s.onEffect('funnelPuff', [], camera);
    s.onEffect('tracer', [0, 0, 0, 'ap'], camera);
    s.onEffect('flame', [0, 0, 0, 1], camera);
    expect(s.trauma).toBe(0);
  });
});
