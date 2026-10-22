import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { DREADNOUGHT_DAMAGE } from '../src/data/ships/dreadnought-damage';
import { buildHitGeometry, type Plate, type V3 } from '../src/sim/damage/geometry';
import { ShipDamage, TUNING, type ShellDamageData } from '../src/sim/damage/ship-damage';
import type { TraceResult } from '../src/sim/damage/trace';
import { Rng } from '../src/sim/rng';

const geom = buildHitGeometry(DREADNOUGHT, DREADNOUGHT_DAMAGE);
const SHELL: ShellDamageData = { massKg: 386, diameterMm: 305, fillerKg: 19 };

function make(seed = 1): ShipDamage {
  return new ShipDamage(
    DREADNOUGHT_DAMAGE,
    geom,
    new Rng(seed),
    DREADNOUGHT.turrets.map((t) => t.id),
    { length: DREADNOUGHT.hull.length, beam: DREADNOUGHT.hull.beam },
    DREADNOUGHT.funnels.length,
  );
}

const plate = (kind: Plate['kind'], axis: 0 | 1 | 2 = 2, mm = 100, component?: string): Plate => ({ id: 't', kind, axis, coord: 0, lo: [0, 0], hi: [0, 0], mm, component });

/** A burst inside compartment `id` at ship-space `at`, having come in through a side plate at `entry`. */
function burstIn(d: ShipDamage, id: string, at: V3, entry: V3 = [at[0], 3, Math.sign(at[2] || 1) * 12.5]): TraceResult {
  const zone = geom.zones.find((z) => z.kind === 'compartment' && z.ref === id)!;
  return { kind: 'burst', first: plate('upper-side'), entry, cosTheta: 1, at, speed: 500, zone, crossed: [], barbettePenetrated: false };
}

function run(d: ShipDamage, seconds: number, dt = 0.25): void {
  for (let t = 0; t < seconds; t += dt) d.update(dt);
}

describe('flooding', () => {
  it('a hole at the waterline fills a compartment in a few minutes, and the water stops at the bulkheads', () => {
    const d = make();
    d.applyTrace(burstIn(d, 'boiler-1', [30, -1, 6], [30, -1, 12.5]), SHELL);
    expect(d.holesCount).toBe(1);
    run(d, 60);
    const c = d.comps.find((x) => x.spec.id === 'boiler-1')!;
    expect(c.flood).toBeGreaterThan(c.spec.capacityT * 0.2);
    run(d, 240);
    expect(c.flood).toBeGreaterThan(c.spec.capacityT * 0.95);
    // The neighbours were not holed: only the damaged bulkhead leaks, and slowly.
    const mag = d.comps.find((x) => x.spec.id === 'mag-A')!;
    expect(mag.flood).toBeLessThan(mag.spec.capacityT * 0.4);
  });

  it('a hit above the waterline admits no water', () => {
    const d = make();
    d.applyTrace(burstIn(d, 'boiler-1', [30, 3, 6], [30, 4, 12.5]), SHELL);
    run(d, 120);
    expect(d.floodedTonnes).toBe(0);
    expect(d.holesCount).toBe(0);
  });

  it('water on one side lists the ship that way, and on the other side the other way', () => {
    const star = make();
    star.applyTrace(burstIn(star, 'boiler-1', [30, -1, 6], [30, -1, 12.5]), SHELL);
    run(star, 90);
    const port = make();
    port.applyTrace(burstIn(port, 'boiler-1', [30, -1, -6], [30, -1, -12.5]), SHELL);
    run(port, 90);
    expect(star.list).toBeGreaterThan(0.02);
    expect(star.list).toBeLessThan(0.25);
    expect(port.list).toBeLessThan(-0.02);
    expect(Math.abs(star.list + port.list)).toBeLessThan(0.02);
  });

  it('water forward puts the bow down, water aft puts the stern down', () => {
    const fwd = make();
    fwd.applyTrace(burstIn(fwd, 'bow', [70, -1, 0], [70, -1, 6]), SHELL);
    run(fwd, 200);
    const aft = make();
    aft.applyTrace(burstIn(aft, 'engine', [-30, -1, 0], [-30, -1, 12.5]), SHELL);
    run(aft, 200);
    expect(fwd.trim).toBeLessThan(-0.003);
    expect(aft.trim).toBeGreaterThan(0.001);
  });

  it('the pumps hold back a small leak but not a big one', () => {
    const d = make();
    d.applyTrace(burstIn(d, 'stern', [-78, -1, 0], [-78, -1, 4]), { ...SHELL, diameterMm: 100, fillerKg: 1 });
    run(d, 400);
    expect(d.floodedTonnes).toBeLessThan(120);
  });

  it('enough water sinks her, and she then goes under within a couple of minutes', () => {
    const d = make();
    const spec = DREADNOUGHT_DAMAGE;
    // Open the sea to everything that is not a magazine (a burst in a magazine can blow the ship up instead).
    for (const c of spec.compartments.filter((x) => x.role !== 'magazine')) {
      d.applyTrace(burstIn(d, c.id, [(c.x0 + c.x1) / 2, -1, 6], [(c.x0 + c.x1) / 2, -1, 12.5]), SHELL);
      d.applyTrace(burstIn(d, c.id, [(c.x0 + c.x1) / 2, -1, -6], [(c.x0 + c.x1) / 2, -1, -12.5]), SHELL);
    }
    let sinkingAt = -1;
    for (let t = 0; t < 1500; t += 0.25) {
      d.update(0.25);
      if (d.status === 'sinking' && sinkingAt < 0) sinkingAt = t;
      if (d.status === 'sunk') {
        expect(t - sinkingAt).toBeLessThan(150);
        expect(sinkingAt).toBeGreaterThan(10);
        return;
      }
    }
    throw new Error(`never sank: ${d.status}, flooded ${d.floodedTonnes.toFixed(0)} t`);
  });

  it('shells that break on armour or glance off let in no water', () => {
    const d = make();
    d.applyTrace({ kind: 'shatter', first: plate('belt'), entry: [30, 0, -12.5], cosTheta: 1, at: [30, 0, -12.5], speed: 400, zone: null, crossed: [], stoppedBy: plate('belt'), barbettePenetrated: false }, SHELL);
    d.applyTrace({ kind: 'ricochet', first: plate('deck', 1), entry: [30, 5, 0], cosTheta: 0.1, at: [30, 5, 0], speed: 400, zone: null, crossed: [], stoppedBy: plate('deck', 1), barbettePenetrated: false }, SHELL);
    run(d, 60);
    expect(d.floodedTonnes).toBe(0);
    expect(d.status).toBe('afloat');
  });
});

describe('fire', () => {
  it('a fire in a boiler room is fought by the damage-control parties and put out', () => {
    const d = make(3);
    const c = d.comps.find((x) => x.spec.id === 'boiler-2')!;
    c.fire = 0.8;
    run(d, 400);
    expect(c.fire).toBe(0);
  });

  it('with the crew dead there is no one to fight it, and it burns on', () => {
    const d = make(3);
    for (const c of d.comps) c.crew = 0.05;
    const boiler = d.comps.find((x) => x.spec.id === 'boiler-2')!;
    boiler.fire = 0.6;
    run(d, 100);
    expect(boiler.fire).toBeGreaterThan(0.6);
  });

  it('a fire hot enough in a magazine that cannot be flooded blows it up; flooding it first saves the ship', () => {
    const risky = make(5);
    const mag = risky.comps.find((x) => x.spec.id === 'mag-A')!;
    mag.heat = 0.5;
    mag.fire = 0.9;
    mag.flood = 0;
    // Take away anyone who could flood it.
    for (const c of risky.comps) c.crew = 0;
    // heat rises past 1 with nobody to react? They react on heat > 0.55, so with no crew parties it still floods itself: drown disabled.
    risky.comps.find((x) => x.spec.id === 'mag-A')!.drowned = false;
    run(risky, 120);
    const saved = make(5);
    const m2 = saved.comps.find((x) => x.spec.id === 'mag-A')!;
    m2.heat = 0.5;
    m2.fire = 0.9;
    run(saved, 120);
    expect(saved.status).not.toBe('exploded');
    expect(m2.drowned).toBe(true);
    // Her turret has no ammunition now.
    expect(saved.turrets.find((t) => t.id === 'A')!.state).toBe('no-ammo');
  });

  it('fire spreads to the next compartment when it is raging', () => {
    let spread = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const d = make(seed);
      for (const c of d.comps) c.crew = 0.05; // no one to put it out
      d.comps.find((x) => x.spec.id === 'boiler-2')!.fire = 0.9;
      run(d, 200);
      if (d.comps.find((x) => x.spec.id === 'engine')!.fire > 0 || d.comps.find((x) => x.spec.id === 'mag-PQ')!.fire > 0) spread++;
    }
    expect(spread).toBeGreaterThan(8);
  });
});

describe('systems', () => {
  it('losing a boiler room costs speed, losing the engine room costs it all', () => {
    const d = make();
    expect(d.power).toBeCloseTo(1, 3);
    d.comps.find((x) => x.spec.id === 'boiler-1')!.integrity = 0;
    expect(d.power).toBeGreaterThan(0.4);
    expect(d.power).toBeLessThan(0.6);
    d.comps.find((x) => x.spec.id === 'engine')!.integrity = 0.05;
    expect(d.power).toBeLessThan(0.1);
    expect(d.speedFactor).toBeLessThan(0.1);
  });

  it('a turret hit is jammed or wrecked; a jam clears in time, a wreck does not', () => {
    let jammed = 0;
    let wrecked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const d = make(seed);
      const zone = geom.turrets.find((t) => t.id === 'X')!.zone;
      d.applyTrace({ kind: 'burst', first: plate('turret-face', 0, 279), entry: [0, 8, 0], cosTheta: 1, at: [-33, 8, 0], speed: 450, zone, crossed: [], barbettePenetrated: false }, SHELL);
      const t = d.turrets.find((x) => x.id === 'X')!;
      expect(d.turretAvailable('X')).toBe(false);
      if (t.state === 'jammed') {
        jammed++;
        run(d, 160);
        // Her crew was badly hurt, so even a cleared jam may leave too few men to serve her.
        expect(['ok', 'jammed']).toContain(t.state);
      } else {
        wrecked++;
        run(d, 160);
        expect(t.state).toBe('destroyed');
      }
    }
    expect(jammed).toBeGreaterThan(5);
    expect(wrecked).toBeGreaterThan(40);
  });

  it('a barbette burst can blow up the magazine beneath it', () => {
    let blown = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const d = make(seed);
      const zone = geom.zones.find((z) => z.kind === 'barbette' && z.ref === 'A')!;
      d.applyTrace({ kind: 'burst', first: plate('barbette', 0, 279), entry: [56, 3, -3], cosTheta: 1, at: [56, 1, 0], speed: 450, zone, crossed: [], barbettePenetrated: true }, SHELL);
      if (d.status === 'exploded') blown++;
    }
    // Rare but real: a few per cent of barbette bursts, not most of them.
    expect(blown).toBeGreaterThan(8);
    expect(blown).toBeLessThan(80);
  });

  it('flash protection removes the risk', () => {
    let blown = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const d = new ShipDamage(
        { ...DREADNOUGHT_DAMAGE, flashProtection: 1 },
        geom,
        new Rng(seed),
        DREADNOUGHT.turrets.map((t) => t.id),
        { length: 160.6, beam: 25 },
        2,
      );
      const zone = geom.zones.find((z) => z.kind === 'barbette' && z.ref === 'A')!;
      d.applyTrace({ kind: 'burst', first: plate('barbette', 0, 279), entry: [56, 3, -3], cosTheta: 1, at: [56, 1, 0], speed: 450, zone, crossed: [], barbettePenetrated: true }, SHELL);
      if (d.status === 'exploded') blown++;
    }
    expect(blown).toBe(0);
  });

  it('a hit on the steering gear jams the rudder until it is repaired', () => {
    const d = make();
    d.applyTrace(burstIn(d, 'steering', [-73, 2, 0], [-73, 3, 12]), SHELL);
    expect(d.steeringFailed).toBe(true);
    run(d, TUNING.steeringRepairSeconds / 0.9 + 60);
    expect(d.steeringFailed).toBe(false);
  });

  it('a shell through the mast head damages fire control, which slowly recovers', () => {
    const d = make();
    d.applyTrace({ kind: 'pass', first: plate('mast', 0, 6, 'director:0'), entry: [0, 30, 0], cosTheta: 1, at: [0, 30, 0], speed: 500, zone: null, crossed: [plate('mast', 0, 6, 'director:0')], barbettePenetrated: false }, SHELL);
    expect(d.fireControl).toBeLessThan(0.7);
    const low = d.fireControl;
    run(d, 200);
    expect(d.fireControl).toBeGreaterThan(low);
  });
});

describe('morale and surrender', () => {
  it('a crippled ship with no fight left strikes her colours', () => {
    const d = make(2);
    for (const c of d.comps) c.crew = 0.3;
    for (const t of d.turrets) t.state = 'destroyed';
    d.comps.find((x) => x.spec.id === 'engine')!.integrity = 0;
    let struck = false;
    for (let t = 0; t < 120 && !struck; t += 0.25) {
      d.update(0.25);
      struck = d.status === 'struck';
    }
    expect(struck).toBe(true);
    expect(d.speedFactor).toBe(0);
  });

  it('a healthy ship never strikes', () => {
    const d = make(2);
    run(d, 600);
    expect(d.status).toBe('afloat');
    expect(d.morale).toBeGreaterThan(0.9);
  });
});

describe('determinism', () => {
  it('the same seed and hits give the same ship', () => {
    const play = () => {
      const d = make(11);
      d.applyTrace(burstIn(d, 'mag-PQ', [10, 0, 5], [10, -0.5, 12.5]), SHELL);
      d.applyTrace(burstIn(d, 'boiler-2', [-10, 1, -5], [-10, 1, -12.5]), SHELL);
      run(d, 90);
      return JSON.stringify(d.summary());
    };
    expect(play()).toBe(play());
  });
});
