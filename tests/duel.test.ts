import { describe, expect, it } from 'vitest';
import { DREADNOUGHT_SETUP, PRE_DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { AGGRESSIVE, CLOSING_GUNNER, STEADY_GUNNER, type AiProfile } from '../src/sim/combat/ai';
import { Duel } from '../src/sim/combat/duel';
import { azimuthTo, solveFiring } from '../src/sim/gunnery/fire-control';
import { GUN_17_40_SK, GUN_28_40_SK } from '../src/sim/gunnery/guns';
import { TargetTrack } from '../src/sim/gunnery/target-track';
import { Rng } from '../src/sim/rng';

const DEG = Math.PI / 180;
const BEATEN = new Set(['struck', 'sinking', 'sunk', 'exploded']);

function duel(seed: number, player: AiProfile): Duel {
  const rng = new Rng(seed * 977);
  const range = 12000 + rng.next() * 4000;
  const bearing = rng.next() * Math.PI * 2;
  return new Duel({
    seed,
    a: { setup: DREADNOUGHT_SETUP, ai: player, x: 0, z: 0, headingDeg: rng.next() * 360 },
    b: { setup: PRE_DREADNOUGHT_SETUP, ai: AGGRESSIVE, x: Math.sin(bearing) * range, z: -Math.cos(bearing) * range, headingDeg: rng.next() * 360 },
    env: { windX: (rng.next() - 0.5) * 16, windZ: (rng.next() - 0.5) * 16, coriolisLatitudeDeg: 52, densityScale: 1 },
  });
}

describe('the duel, HMS Dreadnought against a pre-dreadnought', () => {
  it('a player who closes wins in minutes, takes some punishment, and the enemy ends beaten', () => {
    let tookBursts = 0;
    let won = 0;
    const times: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const d = duel(seed, CLOSING_GUNNER);
      const outcome = d.run(2400);
      // Now and then the enemy gets away or the gunnery takes its time: that is a draw, not a defeat.
      expect(outcome === 'a-won' || outcome === 'draw').toBe(true);
      expect(d.a.damage.status === 'afloat' || d.a.damage.status === 'crippled').toBe(true);
      if (outcome === 'a-won') {
        won++;
        expect(BEATEN.has(d.b.damage.status)).toBe(true);
        times.push(d.time);
        expect(d.b.hitsTaken).toBeGreaterThanOrEqual(1);
      }
      if (d.a.hitsTaken > 0) tookBursts++;
    }
    expect(won).toBeGreaterThanOrEqual(5);
    times.sort((x, y) => x - y);
    const median = times[Math.floor(times.length / 2)]!;
    expect(median).toBeGreaterThan(150);
    expect(median).toBeLessThan(1500);
    // The pre-dreadnought is not harmless: across six duels at close range she gets through at least once.
    expect(tookBursts).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('a player who keeps his distance is almost never hurt but needs longer', () => {
    let beaten = 0;
    for (const seed of [1, 2, 3, 4]) {
      const d = duel(seed, STEADY_GUNNER);
      const outcome = d.run(2400);
      expect(outcome === 'a-won' || outcome === 'draw').toBe(true);
      if (outcome === 'a-won') beaten++;
      expect(d.a.damage.status).not.toBe('sunk');
      expect(d.a.damage.status).not.toBe('exploded');
    }
    expect(beaten).toBeGreaterThanOrEqual(3);
  }, 240_000);

  it('is deterministic: the same seed fights the same fight', () => {
    const summary = () => {
      const d = duel(7, CLOSING_GUNNER);
      for (let i = 0; i < 60 * 300; i++) d.step();
      return JSON.stringify([d.a.damage.summary(), d.b.damage.summary(), d.a.shellsFired, d.b.shellsFired, d.b.impacts]);
    };
    expect(summary()).toBe(summary());
  }, 60_000);

  it('the German guns reach about 19 km at full elevation, and the casemate guns about 14 km', () => {
    const range = (gun: typeof GUN_28_40_SK) => {
      const own = { x: 0, z: 0, vx: 0, vz: 0, muzzleHeight: 10 };
      let reach = 0;
      for (let r = 8000; r <= 24000; r += 250) {
        const s = solveFiring(own, { x: 0, z: -r, vx: 0, vz: 0 }, gun.shell, gun.maxElevationDeg * DEG);
        if (s.valid) reach = r;
      }
      return reach;
    };
    expect(range(GUN_28_40_SK)).toBeGreaterThan(17000);
    expect(range(GUN_28_40_SK)).toBeLessThan(21000);
    expect(range(GUN_17_40_SK)).toBeGreaterThan(12000);
    expect(range(GUN_17_40_SK)).toBeLessThan(15500);
  });
});

describe('robustness of the plot and the solution', () => {
  it('a handful of early noisy readings does not send the guns after an impossible speed', () => {
    const rng = new Rng(3);
    const track = new TargetTrack();
    for (let t = 0; t <= 8; t += 2) {
      const range = 12000 + rng.gaussian() * 130;
      track.observe(t, 0, 0, range, 0.2 + rng.gaussian() * 0.0006);
    }
    const e = track.estimate(8)!;
    expect(Math.hypot(e.vx, e.vz)).toBeLessThan(10);
    // And never faster than any ship goes, however wild the readings.
    const wild = new TargetTrack();
    for (let t = 0; t <= 30; t += 2) wild.observe(t, 0, 0, 10000 + (t % 4 === 0 ? 900 : -900) + t * 60, 0.1);
    const w = wild.estimate(30)!;
    expect(Math.hypot(w.vx, w.vz)).toBeLessThanOrEqual(25.001);
  });

  it('the solver cannot be sent far off by an absurd target velocity: it falls back to aiming at the target', () => {
    const own = { x: 0, z: 0, vx: 0, vz: 0, muzzleHeight: 10 };
    const s = solveFiring(own, { x: 3000, z: -12000, vx: -30, vz: 90 }, GUN_28_40_SK.shell, 30 * DEG);
    const bearing = azimuthTo(3000, -12000);
    const off = Math.abs(Math.atan2(Math.sin(s.azimuth - bearing), Math.cos(s.azimuth - bearing)));
    expect(off).toBeLessThan(0.5);
    expect(s.elevation).toBeGreaterThan(0);
    expect(s.elevation).toBeLessThan(0.6);
  });
});
