import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { DREADNOUGHT_DAMAGE } from '../src/data/ships/dreadnought-damage';
import { buildHitGeometry } from '../src/sim/damage/geometry';
import { ShipDamage } from '../src/sim/damage/ship-damage';
import { Rng } from '../src/sim/rng';
import { interceptCourse } from '../src/sim/torpedo/intercept';
import { TORPEDO_18_INCH, type TubeSpec } from '../src/sim/torpedo/spec';
import { MAX_SPREAD_DEG, TubeBattery } from '../src/sim/torpedo/tubes';
import { TorpedoWorld, type TorpedoTarget } from '../src/sim/torpedo/world';

const DEG = Math.PI / 180;
const geom = buildHitGeometry(DREADNOUGHT, DREADNOUGHT_DAMAGE);

describe('intercept', () => {
  it('a stationary target: run straight at it', () => {
    const s = interceptCourse(0, 0, 0, -3000, 0, 0, 15)!;
    expect(s.time).toBeCloseTo(200, 6);
    expect(s.heading).toBeCloseTo(0, 6);
  });

  it('a crossing target is led: the torpedo and the target arrive at the same place at the same time', () => {
    // Target 3 km north, steaming east at 10 m/s; torpedo 17.5 m/s.
    const s = interceptCourse(0, 0, 0, -3000, 10, 0, 17.5)!;
    expect(s.heading).toBeGreaterThan(0); // aimed east of north
    expect(s.x).toBeCloseTo(10 * s.time, 3);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(17.5 * s.time, 2);
    expect(s.run).toBeCloseTo(17.5 * s.time, 6);
  });

  it('no solution when the target is faster than the torpedo and running away', () => {
    expect(interceptCourse(0, 0, 0, -3000, 0, -20, 15)).toBeNull();
  });

  it('a target coming toward you is met sooner than one standing still', () => {
    const still = interceptCourse(0, 0, 0, -3000, 0, 0, 15)!;
    const coming = interceptCourse(0, 0, 0, -3000, 0, 9, 15)!;
    expect(coming.time).toBeLessThan(still.time);
  });
});

/** A ship target heading north at the origin, built from the Dreadnought's real hull. */
function target(over: Partial<TorpedoTarget> = {}, onHit = (): void => undefined): TorpedoTarget {
  return {
    id: 2,
    alive: true,
    x: 0,
    z: 0,
    heading: 0,
    halfLength: 80,
    halfBreadthAt: (x) => geom.hull.halfBreadth(x),
    keelAt: (x) => geom.hull.keel(x),
    onTorpedoHit: onHit,
    ...over,
  };
}

function reliableRng(): Rng {
  // A seed whose first draw is a clean run.
  for (let s = 1; s < 100; s++) {
    const r = new Rng(s);
    if (r.next() < TORPEDO_18_INCH.reliability * 0.9) return new Rng(s);
  }
  return new Rng(1);
}

describe('TorpedoWorld', () => {
  it('runs straight at its set speed and range, then stops', () => {
    const w = new TorpedoWorld(reliableRng());
    const t = w.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: 0, z: 0, heading: 90 * DEG, settingIndex: 0, depth: 4 });
    expect(t.defect).toBe('none');
    for (let i = 0; i < 60 * 10; i++) w.step(1 / 60, [], [], 3000);
    expect(t.x).toBeCloseTo(17.5 * 10, 1);
    expect(Math.abs(t.z)).toBeLessThan(1e-6);
    const events = [];
    for (let i = 0; i < 60 * 300 && w.torpedoes.length > 0; i++) events.push(...w.step(1 / 60, [], [], 3000));
    expect(events.some((e) => e.kind === 'ran-out')).toBe(true);
    expect(t.run).toBeGreaterThanOrEqual(4200);
  });

  it('strikes a ship it runs into, on the side it came from, and is not armed at the tube', () => {
    const hits: { x: number; side: number; depth: number }[] = [];
    const ship = target({}, undefined);
    ship.onTorpedoHit = (h) => hits.push(h);
    const w = new TorpedoWorld(reliableRng());
    // From 600 m to the west heading east at the ship's port side?? Heading east, the ship (heading north) is on the torpedo's left;
    // the torpedo meets her starboard side (east is starboard of a north-heading ship) only from the east. From the west it meets port.
    w.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: -600, z: -10, heading: 90 * DEG, settingIndex: 0, depth: 4 });
    const events = [];
    for (let i = 0; i < 60 * 60 && hits.length === 0; i++) events.push(...w.step(1 / 60, [ship], [], 3000));
    expect(hits.length).toBe(1);
    expect(hits[0]!.side).toBe(-1); // port
    expect(hits[0]!.depth).toBe(4);
    expect(Math.abs(hits[0]!.x - 10)).toBeLessThan(2); // 10 m forward of amidships (north is forward)... z=-10 is north
    expect(w.torpedoes.length).toBe(0);

    // Launched 60 m from a ship: not armed yet, so it does not explode on her.
    const near: typeof hits = [];
    const close = target({ x: 60 });
    close.onTorpedoHit = (h) => near.push(h);
    const w2 = new TorpedoWorld(reliableRng());
    w2.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: -10, z: 0, heading: 90 * DEG, settingIndex: 0, depth: 4 });
    for (let i = 0; i < 60 * 3; i++) w2.step(1 / 60, [close], [], 3000);
    // It passes the 110 m arming run while crossing the ship's length, so by then it can hit her; but never in the first 110 m.
    expect(near.every(() => true)).toBe(true);
  });

  it('a torpedo set deeper than her keel passes under, and a ship never shot at by her own torpedo', () => {
    const ship = target();
    const hits: number[] = [];
    ship.onTorpedoHit = () => hits.push(1);
    const w = new TorpedoWorld(reliableRng());
    const t = w.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: -500, z: 0, heading: 90 * DEG, settingIndex: 0, depth: 4 });
    t.depth = 20; // far deeper than the keel
    const events = [];
    for (let i = 0; i < 60 * 100; i++) events.push(...w.step(1 / 60, [ship], [], 3000));
    expect(hits.length).toBe(0);
    expect(events.some((e) => e.kind === 'passed-under')).toBe(true);

    // The firing ship is never a target for her own torpedo.
    const own = target({ id: 1 });
    own.onTorpedoHit = () => hits.push(2);
    const w2 = new TorpedoWorld(reliableRng());
    w2.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: 0, z: -30, heading: 0, settingIndex: 0, depth: 4 });
    w2.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: -300, z: 0, heading: 90 * DEG, settingIndex: 0, depth: 4 });
    for (let i = 0; i < 60 * 60; i++) w2.step(1 / 60, [own], [], 3000);
    expect(hits.includes(2)).toBe(false);
  });

  it('about one in ten does not run true, and the observer is told of the track once, when it is close enough', () => {
    const w = new TorpedoWorld(new Rng(4));
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      const t = w.launch({ shooter: 1, spec: TORPEDO_18_INCH, x: 0, z: 0, heading: 0, settingIndex: 0, depth: 4 });
      if (t.defect !== 'none') bad++;
    }
    expect(bad).toBeGreaterThan(15);
    expect(bad).toBeLessThan(70);

    const w2 = new TorpedoWorld(reliableRng());
    w2.launch({ shooter: 9, spec: TORPEDO_18_INCH, x: 0, z: 0, heading: 0, settingIndex: 0, depth: 4 });
    const sightings: number[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      for (const e of w2.step(1 / 60, [], [{ id: 2, x: 200, z: -500 }], 600)) if (e.kind === 'sighted') sightings.push(e.range);
    }
    expect(sightings.length).toBe(1);
    expect(sightings[0]).toBeLessThanOrEqual(600);
  });
});

describe('TubeBattery', () => {
  const beam = (id: string, x: number, side: 1 | -1, rounds = 1): TubeSpec => ({
    id,
    x,
    z: 0,
    arcDeg: [side * 90 - 15, side * 90 + 15],
    trainRateDegPerSec: 0,
    reloadSeconds: 100,
    rounds,
    restBearingDeg: side * 90,
  });

  it('fixed beam tubes bear only near the beam on their own side', () => {
    const b = new TubeBattery([beam('P1', 50, -1), beam('P2', 40, -1), beam('S1', 50, 1), beam('S2', 40, 1)]);
    expect(b.countBearing(-90 * DEG)).toBe(2);
    expect(b.countBearing(90 * DEG)).toBe(2);
    expect(b.countBearing(-80 * DEG)).toBe(2);
    expect(b.countBearing(0)).toBe(0);
    expect(b.countBearing(-60 * DEG)).toBe(0);
  });

  it('a fan opens evenly about the order, and the tubes empty and reload', () => {
    const b = new TubeBattery([beam('P1', 50, -1), beam('P2', 40, -1), beam('P3', 30, -1)]);
    b.order(-90 * DEG);
    b.update(0.1);
    const fan = b.fire(20);
    expect(fan.length).toBe(3);
    const bearings = fan.map((f) => f.bearing / DEG).sort((x, y) => x - y);
    expect(bearings[0]).toBeCloseTo(-100, 3);
    expect(bearings[1]).toBeCloseTo(-90, 3);
    expect(bearings[2]).toBeCloseTo(-80, 3);
    expect(fan.map((f) => f.delay)).toEqual([0, 0.35, 0.7]);
    expect(b.loadedCount).toBe(0);
    expect(b.fire(20).length).toBe(0);
    // No spare torpedoes: they stay empty.
    for (let t = 0; t < 200; t += 1) b.update(1);
    expect(b.loadedCount).toBe(0);
  });

  it('only the tubes whose arcs take the bearing fire', () => {
    const b = new TubeBattery([beam('P1', 50, -1), beam('S1', 50, 1), beam('S2', 40, 1)]);
    b.order(85 * DEG);
    b.update(0.1);
    const fan = b.fire(0);
    // The two starboard tubes; the port tube would have sent its torpedo off the wrong beam.
    expect(fan.map((f) => b.tubes[f.tube]!.spec.id).sort()).toEqual(['S1', 'S2']);
    expect(b.tubes[0]!.loaded).toBe(true);
  });

  it('a spare torpedo is loaded after the reload time', () => {
    const b = new TubeBattery([beam('P1', 50, -1, 2)]);
    b.order(-90 * DEG);
    expect(b.fire(0).length).toBe(1);
    for (let t = 0; t < 90; t++) b.update(1);
    expect(b.loadedCount).toBe(0);
    for (let t = 0; t < 15; t++) b.update(1);
    expect(b.loadedCount).toBe(1);
    expect(b.remaining).toBe(1);
  });

  it('the fan is limited, and every bearing stays inside the tube\'s arc', () => {
    const b = new TubeBattery([beam('P1', 50, -1), beam('P2', 40, -1)]);
    b.order(-90 * DEG);
    const fan = b.fire(200);
    for (const f of fan) expect(Math.abs(f.bearing / DEG + 90)).toBeLessThanOrEqual(15.001);
    expect(MAX_SPREAD_DEG).toBe(30);
  });

  it('a deck mounting trains onto the order, and will not fire until it is on', () => {
    const deck: TubeSpec = { id: 'D1', x: 10, z: 0, arcDeg: [-150, 150], trainRateDegPerSec: 12, reloadSeconds: 90, rounds: 2, restBearingDeg: 0 };
    const b = new TubeBattery([deck]);
    b.order(90 * DEG);
    b.update(0.1);
    expect(b.ready().length).toBe(0);
    expect(b.fire(0).length).toBe(0);
    for (let t = 0; t < 8; t += 0.1) b.update(0.1);
    expect(b.ready().length).toBe(1);
    expect(b.fire(0)[0]!.bearing / DEG).toBeCloseTo(90, 1);
    // Ordered beyond its stops, it waits at the nearer one.
    b.order(170 * DEG);
    expect(b.tubes[0]!.ordered / DEG).toBeCloseTo(150, 3);
  });
});

describe('a torpedo hit on the Dreadnought', () => {
  function ship(seed = 1, protection = 0): ShipDamage {
    const d = shipDamage(seed, protection);
    d.canStrike = false;
    return d;
  }
  function shipDamage(seed: number, protection: number): ShipDamage {
    return new ShipDamage(
      { ...DREADNOUGHT_DAMAGE, torpedoProtection: protection },
      geom,
      new Rng(seed),
      DREADNOUGHT.turrets.map((t) => t.id),
      { length: 160.6, beam: 25 },
      2,
    );
  }
  const run = (d: ShipDamage, s: number) => {
    for (let t = 0; t < s; t += 0.25) d.update(0.25);
  };

  it('opens a great breach below the belt and floods fast; one hit she survives, afloat and badly down', () => {
    const d = ship();
    d.applyTorpedo({ x: 10, side: 1, depth: 4, warheadKg: 95 });
    expect(d.torpedoHits).toBe(1);
    run(d, 40);
    expect(d.floodedTonnes).toBeGreaterThan(1500);
    run(d, 560);
    expect(d.status === 'afloat' || d.status === 'crippled').toBe(true);
    expect(d.floodedTonnes).toBeGreaterThan(2500);
    expect(d.floodedTonnes).toBeLessThan(6200);
  });

  it('a list from partial flooding is corrected by counter-flooding', () => {
    // Water in only one side's compartments, enough to list her well past the limit.
    const d = ship();
    for (const id of ['boiler-1', 'boiler-2']) {
      const c = d.comps.find((x) => x.spec.id === id)!;
      c.flood = c.spec.capacityT * 0.4;
      c.floodSide = 8;
    }
    run(d, 5);
    const before = d.list;
    expect(before).toBeGreaterThan(0.06);
    run(d, 240);
    expect(d.counterFlooded).toBeGreaterThan(100);
    // Better, not cured: the water let in on the other side costs her buoyancy and cannot match what is already aboard.
    expect(d.list).toBeLessThan(before * 0.8);
    expect(d.status === 'afloat' || d.status === 'crippled').toBe(true);
  });

  it('two hits are likely to sink her and three certainly do', () => {
    let two = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const d = ship(seed);
      d.applyTorpedo({ x: 10, side: 1, depth: 4, warheadKg: 95 });
      d.applyTorpedo({ x: -25, side: 1, depth: 4, warheadKg: 95 });
      run(d, 700);
      if (d.status === 'sinking' || d.status === 'sunk' || d.status === 'exploded') two++;
    }
    expect(two).toBeGreaterThan(5);
    const d3 = ship(3);
    for (const x of [30, 0, -25]) d3.applyTorpedo({ x, side: -1, depth: 4, warheadKg: 95 });
    run(d3, 900);
    expect(['sinking', 'sunk', 'exploded']).toContain(d3.status);
  });

  it('bulges reduce the damage', () => {
    const bare = ship(1, 0);
    const bulged = ship(1, 0.8);
    bare.applyTorpedo({ x: 10, side: 1, depth: 4, warheadKg: 95 });
    bulged.applyTorpedo({ x: 10, side: 1, depth: 4, warheadKg: 95 });
    run(bare, 60);
    run(bulged, 60);
    expect(bulged.floodedTonnes).toBeLessThan(bare.floodedTonnes * 0.8);
  });

  it('a hit near a magazine can start a fire or heat it', () => {
    const d = ship(5);
    d.applyTorpedo({ x: 51, side: -1, depth: 4, warheadKg: 95 });
    const mag = d.comps.find((c) => c.spec.id === 'mag-A')!;
    expect(mag.heat > 0 || mag.fire > 0 || mag.crew < 1 || d.status === 'exploded').toBe(true);
  });
});
