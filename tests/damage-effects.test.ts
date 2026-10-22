import { describe, expect, it } from 'vitest';
import { Effects } from '../src/render/fx/effects';
import { FILM, GLOW, PUFF, type ParticleDesc, type ParticleSystem } from '../src/render/fx/particles';

/** An Effects that spawns into a list instead of onto the GPU. */
function setup() {
  const spawned: ParticleDesc[] = [];
  const sink = { spawn: (d: ParticleDesc) => void spawned.push(d), setLayerVisible: () => {} } as unknown as ParticleSystem;
  return { fx: new Effects(sink), spawned };
}

const finite = (d: ParticleDesc): boolean => [d.x, d.y, d.z, d.size0, d.size1, d.life, d.r, d.g, d.b, d.alpha].every((v) => Number.isFinite(v));

describe('a ship going under', () => {
  it('leaves wreckage that floats, oil that spreads, and white water over the place', () => {
    const { fx, spawned } = setup();
    fx.shipLost(1000, -2000, 195);
    expect(spawned.every(finite)).toBe(true);
    const floating = spawned.filter((d) => d.seaOffset !== undefined);
    const films = spawned.filter((d) => d.kind === FILM);
    const wreckage = floating.filter((d) => d.kind !== FILM && d.kind !== GLOW && d.life > 100);
    expect(films.length).toBeGreaterThanOrEqual(8);
    expect(wreckage.length).toBeGreaterThanOrEqual(20);
    // The oil grows as it spreads, lasts for minutes, and is nearly black.
    for (const f of films) {
      expect(f.size1).toBeGreaterThan(f.size0 * 2);
      expect(f.life).toBeGreaterThan(150);
      expect(Math.max(f.r, f.g, f.b)).toBeLessThan(0.05);
    }
    // The wreckage is a few metres across, drifts slowly and lies about the place she went down.
    for (const w of wreckage) {
      expect(w.size0).toBeLessThan(4);
      expect(Math.hypot((w.vx ?? 0) as number, (w.vz ?? 0) as number)).toBeLessThan(1);
      expect(Math.hypot(w.x - 1000, w.z + 2000)).toBeLessThan(0.6 * 195);
    }
    // White water: bright foam on the sea.
    const foam = floating.filter((d) => d.kind !== FILM && d.life < 20 && d.r > 0.8);
    expect(foam.length).toBeGreaterThanOrEqual(5);
  });

  it('is in proportion to her size: a destroyer leaves less than a battleship', () => {
    const big = setup();
    big.fx.shipLost(0, 0, 195);
    const small = setup();
    small.fx.shipLost(0, 0, 80);
    expect(small.spawned.length).toBeLessThan(big.spawned.length);
    const reach = (l: ParticleDesc[]) => Math.max(...l.filter((d) => d.kind === FILM).map((d) => d.size1));
    expect(reach(small.spawned)).toBeLessThan(reach(big.spawned));
  });

  it('churns the water white while she settles', () => {
    const { fx, spawned } = setup();
    for (let i = 0; i < 40; i++) fx.boil(0, 0, 1);
    expect(spawned.every(finite)).toBe(true);
    const foam = spawned.filter((d) => d.seaOffset !== undefined);
    expect(foam.length).toBe(200);
    for (const f of foam) {
      expect(f.kind ?? PUFF).toBe(PUFF);
      expect(f.size1).toBeGreaterThan(f.size0);
    }
    // And now and then the air comes out of her as spray.
    expect(spawned.some((d) => d.dieAtSea === true && (d.vy ?? 0) > 4)).toBe(true);
  });
});

describe('a turret blown apart', () => {
  it('throws up a flash, burning fragments, lumps that fall into the sea, and smoke', () => {
    const { fx, spawned } = setup();
    fx.turretWreck(0, 8, 0, 1);
    expect(spawned.every(finite)).toBe(true);
    const flash = spawned.filter((d) => d.kind === GLOW && d.life < 0.5 && d.size1 > 30);
    const sparks = spawned.filter((d) => d.kind === GLOW && d.gravity !== undefined && d.size0 < 3);
    const lumps = spawned.filter((d) => d.dieAtSea === true && d.alpha > 0.9);
    const smoke = spawned.filter((d) => d.kind === undefined && d.life > 8 && d.size1 > 20);
    expect(flash.length).toBe(1);
    expect(sparks.length).toBeGreaterThanOrEqual(15);
    expect(lumps.length).toBeGreaterThanOrEqual(5);
    expect(smoke.length).toBeGreaterThanOrEqual(4);
    // The lumps go up fast and are dark.
    for (const l of lumps) {
      expect((l.vy ?? 0)).toBeGreaterThan(10);
      expect(Math.max(l.r, l.g, l.b)).toBeLessThan(0.05);
    }
  });

  it('is smaller than a magazine going up', () => {
    const turret = setup();
    turret.fx.turretWreck(0, 8, 0, 1);
    const magazine = setup();
    magazine.fx.explosion(0, 8, 0, 1);
    const biggest = (l: ParticleDesc[]) => Math.max(...l.map((d) => d.size1));
    expect(biggest(turret.spawned)).toBeLessThan(biggest(magazine.spawned) / 2);
  });
});
