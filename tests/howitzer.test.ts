import { describe, expect, it } from 'vitest';
import { CALM, flyToSea, launch, rangeAtElevation } from '../src/sim/gunnery/ballistics';
import { chargeFor, solveFiring } from '../src/sim/gunnery/fire-control';
import { GUN_15_40_COAST, GUN_24_HOWITZER, GUN_24_40_COAST } from '../src/sim/gunnery/guns';

const DEG = Math.PI / 180;

describe('the fort guns', () => {
  it('the howitzer reaches about 9-11 km at 45 degrees, and comes down steeply at long range', () => {
    const r = rangeAtElevation(GUN_24_HOWITZER.shell, 45 * DEG, 90)!;
    expect(r.range).toBeGreaterThan(8000);
    expect(r.range).toBeLessThan(12500);
    const steep = rangeAtElevation(GUN_24_HOWITZER.shell, 62 * DEG, 90)!;
    expect(steep.angleDeg).toBeGreaterThan(55);
  });

  it('the coast guns reach 12-17 km from a high site', () => {
    const a = rangeAtElevation(GUN_15_40_COAST.shell, 30 * DEG, 40)!;
    expect(a.range).toBeGreaterThan(11000);
    expect(a.range).toBeLessThan(17500);
    const b = rangeAtElevation(GUN_24_40_COAST.shell, 30 * DEG, 60)!;
    expect(b.range).toBeGreaterThan(11000);
    expect(b.range).toBeLessThan(17500);
  });

  it('a plunging solution is taken for a howitzer, and lands on a target at the sea', () => {
    const gun = GUN_24_HOWITZER;
    const own = { x: 0, z: 0, vx: 0, vz: 0, muzzleHeight: 92 };
    for (const range of [1200, 2500, 3300, 4500, 5700, 7000, 8200, 9000]) {
      const target = { x: 0, z: -range, vx: 0, vz: 0 };
      // The charge is chosen so that the shell comes down at this range on the steep trajectory.
      const shell = chargeFor(gun.shell, gun.charges!, range, own.muzzleHeight);
      const sol = solveFiring(own, target, shell, gun.maxElevationDeg * DEG, undefined, CALM, undefined, { highAngle: true });
      expect(sol.valid).toBe(true);
      // The steep branch: well above 45 degrees.
      expect(sol.elevation).toBeGreaterThan(50 * DEG);
      const hit = flyToSea(launch(shell, [0, own.muzzleHeight, 0], sol.azimuth, sol.elevation), shell, CALM)!;
      expect(Math.hypot(hit.x - target.x, hit.z - target.z)).toBeLessThan(15);
      // It drops steeply.
      expect(hit.angleDeg).toBeGreaterThan(44);
    }
    // Reduced charges: the nearer the target, the smaller the charge.
    expect(chargeFor(gun.shell, gun.charges!, 2500, 92).muzzleVelocity).toBeLessThan(chargeFor(gun.shell, gun.charges!, 9000, 92).muzzleVelocity);
  });

  it('a target on a hilltop is aimed at its own height, not at the sea', () => {
    const gun = GUN_24_40_COAST;
    const own = { x: 0, z: 0, vx: 0, vz: 0, muzzleHeight: 14 };
    const down = solveFiring(own, { x: 0, z: -8000, vx: 0, vz: 0 }, gun.shell, gun.maxElevationDeg * DEG);
    const up = solveFiring(own, { x: 0, z: -8000, vx: 0, vz: 0, y: 120 }, gun.shell, gun.maxElevationDeg * DEG);
    // To strike 120 m up the hill the shell must still be climbing less: it is laid a little higher.
    expect(up.elevation).toBeGreaterThan(down.elevation);
    const hit = flyToSea(launch(gun.shell, [0, own.muzzleHeight, 0], up.azimuth, up.elevation), gun.shell, CALM, 0.05, 200, 120)!;
    expect(Math.hypot(hit.x, hit.z + 8000)).toBeLessThan(15);
  });
});

describe('a target high above the guns', () => {
  it('is hit at close range too, where the flat solution for the sea would never climb to it', () => {
    const gun = GUN_24_40_COAST;
    const own = { x: 0, z: 0, vx: 0, vz: 0, muzzleHeight: 14 };
    // A fort 100 m up at 4.4 km: the elevation that reaches the sea there (about 2 degrees) carries the shell no higher than 60 m.
    const sol = solveFiring(own, { x: 0, z: -4400, vx: 0, vz: 0, y: 100 }, gun.shell, gun.maxElevationDeg * DEG);
    expect(sol.valid).toBe(true);
    const hit = flyToSea(launch(gun.shell, [0, own.muzzleHeight, 0], sol.azimuth, sol.elevation), gun.shell, CALM, 0.05, 200, 100)!;
    expect(hit).not.toBeNull();
    expect(Math.hypot(hit.x, hit.z + 4400)).toBeLessThan(15);
    expect(sol.elevation).toBeGreaterThan(2.6 * DEG);
  });
});
