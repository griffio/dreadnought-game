import { describe, expect, it } from 'vitest';
import {
  BISMARCK_SETUP,
  BISMARCK_WOUNDED_SETUP,
  DREADNOUGHT_SETUP,
  KAISER_SETUP,
  KING_GEORGE_V_SETUP,
  PRE_DREADNOUGHT_SETUP,
  QUEEN_ELIZABETH_SETUP,
  RODNEY_SETUP,
} from '../src/data/ships/fleet';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { BISMARCK_CAPTAIN, STEADY_GUNNER } from '../src/sim/combat/ai';
import { Duel } from '../src/sim/combat/duel';
import { Combatant, minorTurrets } from '../src/sim/combat/combatant';
import type { ShipSetup } from '../src/sim/combat/setup';
import { CALM } from '../src/sim/gunnery/ballistics';
import { rangeAtElevation } from '../src/sim/gunnery/ballistics';
import { battleshipHandling, ShipDynamics } from '../src/sim/ships/dynamics';

const DEG = Math.PI / 180;

const ALL: [string, ShipSetup][] = [
  ['Dreadnought', DREADNOUGHT_SETUP],
  ['Hessen', PRE_DREADNOUGHT_SETUP],
  ['Queen Elizabeth', QUEEN_ELIZABETH_SETUP],
  ['Rodney', RODNEY_SETUP],
  ['King George V', KING_GEORGE_V_SETUP],
  ['Kaiser', KAISER_SETUP],
  ['Bismarck', BISMARCK_SETUP],
  ['Bismarck (wounded)', BISMARCK_WOUNDED_SETUP],
];

function make(setup: ShipSetup): Combatant {
  const dynamics = new ShipDynamics(battleshipHandling(setup.ship.hull.length, setup.maxSpeedKn));
  return new Combatant({
    id: 1,
    name: setup.name,
    ship: setup.ship,
    damage: setup.damage,
    dynamics,
    frame: () => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0 }),
    batteries: setup.batteries,
    rangefinder: setup.rangefinder,
    env: () => CALM,
    visibilityKm: () => 40,
    seed: 1,
    jams: setup.jams,
    wounds: setup.wounds,
    rudderJam: setup.rudderJam,
    neverStrikes: setup.neverStrikes,
  });
}

describe.each(ALL)('the %s as built', (_name, setup) => {
  const ship = setup.ship;
  const half = ship.hull.length / 2;
  const damage = setup.damage;

  it('puts every turret in exactly one battery, and every gun in a battery with a bore that matches its turret', () => {
    const ids = setup.batteries.flatMap((b) => b.turretIds);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ship.turrets) {
      const battery = setup.batteries.find((b) => b.turretIds.includes(t.id));
      expect(battery, `turret ${t.id} has no battery`).toBeDefined();
      // A turret's bore, in the model, is the gun's to within the rounding of a calibre in millimetres.
      expect(Math.abs(t.boreMm - battery!.gun.boreMm)).toBeLessThanOrEqual(26);
      expect(t.maxElevDeg).toBeGreaterThanOrEqual(battery!.gun.maxElevationDeg - 0.5);
    }
    for (const id of ids) expect(ship.turrets.some((t) => t.id === id), `battery names unknown turret ${id}`).toBe(true);
  });

  it('divides the hull into compartments that run end to end, and shares out the power', () => {
    const comps = [...damage.compartments].sort((a, b) => a.x0 - b.x0);
    expect(comps[0]!.x0).toBeCloseTo(-half, 0);
    expect(comps[comps.length - 1]!.x1).toBeCloseTo(half, 0);
    for (let i = 1; i < comps.length; i++) expect(comps[i]!.x0, `gap before ${comps[i]!.id}`).toBeCloseTo(comps[i - 1]!.x1, 3);
    const power = damage.compartments.reduce((s, c) => s + (c.power ?? 0), 0);
    expect(power).toBeCloseTo(1, 3);
    // They are listed bow first or stern first, as the damage code expects its neighbours to be adjacent.
    expect(damage.compartments.map((c) => c.x0)).toEqual([...damage.compartments.map((c) => c.x0)].sort((a, b) => b - a));
  });

  it('feeds every turret from a magazine, under or near the turret, and no magazine feeds a turret that is not there', () => {
    const turretIds = new Set(ship.turrets.map((t) => t.id));
    const minor = new Set(minorTurrets(ship));
    for (const t of ship.turrets) {
      const fed = damage.compartments.filter((c) => c.feeds?.includes(t.id));
      // The Dreadnought's 12-pounders are fed from ready-use lockers, not a magazine of their own.
      expect(fed.length, `turret ${t.id}`).toBe(minor.has(t.id) && ship.name === 'HMS Dreadnought' ? 0 : 1);
    }
    for (const c of damage.compartments) for (const id of c.feeds ?? []) expect(turretIds.has(id), `${c.id} feeds unknown ${id}`).toBe(true);
    // The big turrets sit over their own magazines (the first two ships were laid out more loosely).
    const legacy = ship.name === 'HMS Dreadnought' || ship.name === 'SMS Hessen';
    for (const t of ship.turrets.filter((x) => x.boreMm >= 300 && !legacy)) {
      const mag = damage.compartments.find((c) => c.feeds?.includes(t.id))!;
      expect(t.x).toBeGreaterThanOrEqual(mag.x0 - 1);
      expect(t.x).toBeLessThanOrEqual(mag.x1 + 1);
    }
  });

  it('has everything on the hull, and the turrets clear of each other', () => {
    for (const t of ship.turrets) {
      expect(Math.abs(t.x), t.id).toBeLessThan(half - 2);
      expect(Math.abs(t.z), t.id).toBeLessThan(ship.hull.beam / 2);
    }
    const big = ship.turrets.filter((t) => t.boreMm >= 300);
    for (let i = 0; i < big.length; i++) {
      for (let j = i + 1; j < big.length; j++) {
        const a = big[i]!;
        const b = big[j]!;
        const apart = Math.hypot(a.x - b.x, a.z - b.z);
        expect(apart, `${a.id} and ${b.id}`).toBeGreaterThan(a.barbetteRadius + b.barbetteRadius - 0.01);
      }
    }
    for (const f of ship.funnels) expect(Math.abs(f.x)).toBeLessThan(half);
  });

  it('builds a model, a combatant and a hit geometry', () => {
    const model = buildShip(ship);
    expect(model.turrets.length).toBe(ship.turrets.length);
    expect(model.vertexCount).toBeGreaterThan(1000);
    expect(model.vertexCount).toBeLessThan(120_000);
    const c = make(setup);
    expect(c.batteries.length).toBe(setup.batteries.length);
    expect(c.damage.status).toBe('afloat');
  });

  it('counts only the main guns in the reckoning of how many she has left', () => {
    const minor = minorTurrets(ship);
    const biggest = Math.max(...ship.turrets.map((t) => t.boreMm));
    for (const t of ship.turrets) expect(minor.includes(t.id)).toBe(t.boreMm < biggest * 0.5);
  });
});

describe('the new ships against their history', () => {
  const maxRangeKm = (setup: ShipSetup) => {
    const g = setup.batteries[0]!.gun;
    return (rangeAtElevation(g.shell, g.maxElevationDeg * DEG, 14)?.range ?? 0) / 1000;
  };

  it('guns reach about as far as the real ones did at the elevation the mounting allowed', () => {
    expect(maxRangeKm(QUEEN_ELIZABETH_SETUP)).toBeGreaterThan(21);
    expect(maxRangeKm(QUEEN_ELIZABETH_SETUP)).toBeLessThan(25);
    expect(maxRangeKm(KAISER_SETUP)).toBeGreaterThan(19);
    expect(maxRangeKm(KAISER_SETUP)).toBeLessThan(22);
    expect(maxRangeKm(BISMARCK_SETUP)).toBeGreaterThan(29);
    expect(maxRangeKm(RODNEY_SETUP)).toBeGreaterThan(24);
    expect(maxRangeKm(KING_GEORGE_V_SETUP)).toBeGreaterThan(25);
  });

  it('counts the guns each ship carried', () => {
    const guns = (s: ShipSetup) => s.ship.turrets.filter((t) => t.boreMm >= 300).reduce((n, t) => n + t.guns, 0);
    expect(guns(QUEEN_ELIZABETH_SETUP)).toBe(8);
    expect(guns(RODNEY_SETUP)).toBe(9);
    expect(guns(KING_GEORGE_V_SETUP)).toBe(10);
    expect(guns(KAISER_SETUP)).toBe(10);
    expect(guns(BISMARCK_SETUP)).toBe(8);
  });

  it('puts the Nelsons\' guns all forward and the quadruple turrets where the King George V had them', () => {
    const rodney = RODNEY_SETUP.ship.turrets.filter((t) => t.boreMm >= 300);
    expect(rodney.every((t) => t.x > 40)).toBe(true);
    const kgv = KING_GEORGE_V_SETUP.ship.turrets.filter((t) => t.boreMm >= 300);
    expect(kgv.filter((t) => t.guns === 4).map((t) => t.id).sort()).toEqual(['A', 'Y']);
    expect(KING_GEORGE_V_SETUP.jams?.turretIds).toEqual(['A', 'Y']);
  });

  it('starts the wounded Bismarck hurt: rudder stuck, two turrets gone, water aboard, and no surrender', () => {
    const c = make(BISMARCK_WOUNDED_SETUP);
    expect(c.damage.steeringFailed).toBe(true);
    expect(c.dynamics.rudderJam).toBeCloseTo(-0.35, 3);
    expect(c.damage.canStrike).toBe(false);
    expect(c.damage.turrets.filter((t) => t.state === 'destroyed').map((t) => t.id).sort()).toEqual(['B', 'Y']);
    expect(c.damage.floodedTonnes).toBeGreaterThan(1000);
    // For a while it stays that way: the parties cannot plug a breach that size, nor the crew repair the steering.
    for (let i = 0; i < 60 * 120; i++) c.damage.update(1 / 60);
    expect(c.damage.steeringFailed).toBe(true);
    expect(c.damage.status === 'afloat' || c.damage.status === 'crippled').toBe(true);
  });
});

describe('the King George V\'s quadruple turrets', () => {
  const fight = (seed: number, jams = KING_GEORGE_V_SETUP.jams) =>
    new Duel({
      seed,
      a: { setup: { ...KING_GEORGE_V_SETUP, jams }, ai: { ...STEADY_GUNNER, rangeMin: 13000, rangeMax: 17000 }, x: 0, z: 0, headingDeg: 0 },
      b: { setup: BISMARCK_SETUP, ai: BISMARCK_CAPTAIN, x: 0, z: -18000, headingDeg: 0 },
    });
  const kgv = (d: Duel, pattern: RegExp) => d.log.filter((r) => r.ship.includes('King George') && pattern.test(r.text));

  it('jam as they fire, are told to the bridge, are out of action, and come back after the crew clear them', () => {
    // A sure jam, to see what it does.
    const d = fight(5, { turretIds: ['A', 'Y'], chance: 1, seconds: 40 });
    let sawOut = false;
    let sawBack = false;
    while (d.time < 400) {
      d.step();
      const states = d.a.damage.turrets.filter((t) => t.id === 'A' || t.id === 'Y').map((t) => t.state);
      if (states.includes('jammed')) sawOut = true;
      if (sawOut && states.every((x) => x === 'ok')) {
        sawBack = true;
        break;
      }
    }
    expect(sawOut).toBe(true);
    expect(sawBack).toBe(true);
    const jams = kgv(d, /jammed in the loading cycle/);
    expect(jams.length).toBeGreaterThanOrEqual(1);
    // Only the quadruple turrets, never the twin.
    for (const j of jams) expect(j.text).toMatch(/Turret [AY] /);
    expect(kgv(d, /Turret [AY] is back in action/).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('jam rarely at the real rate: a few times in a long fight, not every salvo', () => {
    let jams = 0;
    let salvos = 0;
    for (const seed of [5, 6, 7]) {
      const d = fight(seed);
      d.run(700);
      jams += kgv(d, /jammed in the loading cycle/).length;
      salvos += Math.floor(d.a.shellsFired / 10);
    }
    expect(salvos).toBeGreaterThan(20);
    expect(jams).toBeGreaterThanOrEqual(1);
    expect(jams).toBeLessThan(salvos * 0.12);
  }, 240_000);

  it('are the King George V\'s alone: the Bismarck\'s turrets do not jam of themselves', () => {
    const d = fight(6);
    d.run(300);
    expect(d.log.some((r) => r.ship.includes('Bismarck') && /jammed in the loading cycle/.test(r.text))).toBe(false);
  }, 120_000);
});
