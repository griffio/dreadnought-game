import { describe, expect, it } from 'vitest';
import { DREADNOUGHT_SETUP, PRE_DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { Combatant } from '../src/sim/combat/combatant';
import type { ShipSetup } from '../src/sim/combat/setup';
import { CALM } from '../src/sim/gunnery/ballistics';
import { GUN_12_45_MK_X } from '../src/sim/gunnery/guns';
import type { DiveInfo, ImpactInfo, LiveShell } from '../src/sim/gunnery/shell-world';
import { battleshipHandling, ShipDynamics } from '../src/sim/ships/dynamics';

const DEG = Math.PI / 180;
const shell12 = GUN_12_45_MK_X.shell;

function make(setup: ShipSetup = DREADNOUGHT_SETUP, seed = 1, headingDeg = 0): Combatant {
  const dynamics = new ShipDynamics(battleshipHandling(setup.ship.hull.length, setup.maxSpeedKn));
  dynamics.heading = headingDeg * DEG;
  dynamics.setTelegraph(3);
  dynamics.speed = dynamics.orderedSpeed;
  return new Combatant({
    id: 7,
    name: setup.name,
    ship: setup.ship,
    damage: setup.damage,
    dynamics,
    frame: () => ({ x: dynamics.x, y: 0, z: dynamics.z, heading: dynamics.heading, pitch: 0, roll: 0, vx: 0, vz: 0 }),
    batteries: setup.batteries,
    rangefinder: setup.rangefinder,
    env: () => CALM,
    visibilityKm: () => 40,
    seed,
  });
}

const liveShell = (spec = shell12): LiveShell => ({
  id: 1,
  salvo: 1,
  shooter: 99,
  spec,
  state: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 },
  passed: [],
  prevX: 0,
  prevY: 0,
  prevZ: 0,
});

/** A step of a shell travelling west (-x) at `speed`, descending at `descent` degrees, reaching x = `atX` at height y. */
function stepWest(atX: number, y: number, z: number, speed: number, descent: number): ImpactInfo {
  const a = descent * DEG;
  const vx = -Math.cos(a) * speed;
  const vy = -Math.sin(a) * speed;
  const dt = 1 / 60;
  return { shell: liveShell(), from: [atX - vx * dt, y - vy * dt, z], to: [atX, y, z], velocity: [vx, vy, 0] };
}

describe('Combatant: hits', () => {
  it('a shell from the east strikes a north-heading ship\'s starboard side, and the right plate decides', () => {
    // The ship sits at the origin heading north; her starboard side is at world x = +12.5 (the waterline half-beam).
    const c = make();
    // Square on to the belt at short range: it goes through and bursts inside.
    const hit = c.resolveHit(stepWest(10.8, 0.4, -30, 700, 2));
    expect(hit?.kind).toBe('burst');
    expect(hit?.consumed).toBe(true);
    expect(c.hitsTaken).toBe(1);
    expect(c.damage.comps.some((x) => x.crew < 1 || x.integrity < 1)).toBe(true);
    // The burst is inboard of the side it came through (the ship's centreline is world x = 0), a few metres.
    expect(hit!.at[0]).toBeLessThan(11);
    expect(hit!.at[0]).toBeGreaterThan(0);
    // At long range the same plate stops it.
    const c2 = make();
    expect(c2.resolveHit(stepWest(10.8, 0.4, -30, 430, 9))?.kind).toBe('shatter');
    expect(c2.hitsTaken).toBe(0);
  });

  it('a shell that flies over the ship and a shell that has not reached her yet both find nothing', () => {
    const c = make();
    expect(c.resolveHit(stepWest(0, 60, 0, 600, 5))).toBeNull();
    expect(c.resolveHit({ shell: liveShell(), from: [200, 10, 0], to: [190, 10, 0], velocity: [-600, 0, 0] })).toBeNull();
  });

  it('the ship\'s heading turns the world into her own frame: a ship heading east is hit on her side by a shell from the north', () => {
    const c = make(DREADNOUGHT_SETUP, 1, 90);
    // Heading east, her starboard side faces south (+z world). A shell from the south, travelling north (-z).
    const info: ImpactInfo = { shell: liveShell(), from: [-30, 0.4, 11.3 + 9], to: [-30, 0.4, 10.6], velocity: [0, -0.01, -700] };
    const hit = c.resolveHit(info);
    expect(hit?.kind).toBe('burst');
  });

  it('a shell that goes straight through light structure flies on', () => {
    const c = make();
    // Through the top of the forward funnel (x local 26): world z = -26 (north is -z), height 13 m, travelling west.
    const info = stepWest(1.5, 12.8, -26, 600, 3);
    const hit = c.resolveHit(info);
    expect(hit?.kind).toBe('pass');
    expect(hit?.consumed).toBe(false);
  });

  it('a shell that falls short and runs under the water can hole her below the belt', () => {
    let holed = 0;
    let attempts = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const c = make(DREADNOUGHT_SETUP, seed);
      const dive: DiveInfo = { shell: liveShell(), x: 40, z: -30, velocity: [-120, -100, 0], speed: Math.hypot(120, 100), angleDeg: 40 };
      attempts++;
      const r = c.resolveDive({ ...dive, velocity: [-400, -60, 0], speed: 405, angleDeg: 8.5, x: 22, z: -30 });
      if (r) holed++;
    }
    expect(attempts).toBe(120);
    // About half survive the water entry; of those, the ones that reach the hull below the belt count.
    expect(holed).toBeGreaterThan(10);
    expect(holed).toBeLessThan(90);
    // A shell that skims in at a shallow angle does not dive at all.
    const c = make();
    expect(c.resolveDive({ shell: liveShell(), x: 22, z: -30, velocity: [-400, -20, 0], speed: 400, angleDeg: 3, })).toBeNull();
  });

  it('a wreck that has gone under is no longer a target', () => {
    const c = make();
    expect(c.alive).toBe(true);
    c.damage.status = 'sunk';
    expect(c.alive).toBe(false);
    expect(c.resolveHit(stepWest(10.8, 0.4, -30, 700, 2))).toBeNull();
  });
});

describe('Combatant: damage works on the ship', () => {
  it('lost boilers slow her; a jammed rudder holds the wheel where it was; a struck ship stops and cannot fire', () => {
    const c = make();
    for (const comp of c.damage.comps.filter((x) => x.spec.role === 'boiler')) comp.integrity = 0;
    c.step(1 / 60, 1, [false]);
    expect(c.dynamics.powerFactor).toBeLessThan(0.6);
    const before = c.dynamics.orderedSpeed;
    expect(before).toBeLessThan(0.6 * 0.8 * 21 * 0.5144 + 0.01);

    // Steering gear wrecked: the rudder is held where it is.
    c.dynamics.rudder = 0.4;
    c.damage.comps.find((x) => x.spec.role === 'steering')!.integrity = 0.2;
    c.damage.applyTrace(
      { kind: 'burst', first: { id: 't', kind: 'upper-side', axis: 2, coord: 0, lo: [0, 0], hi: [0, 0], mm: 25 }, entry: [-73, 3, 12], cosTheta: 1, at: [-73, 2, 0], speed: 400, zone: c.geometry.zones.find((z) => z.ref === 'steering') ?? null, crossed: [], barbettePenetrated: false },
      { massKg: 386, diameterMm: 305, fillerKg: 19 },
    );
    c.step(1 / 60, 2, [false]);
    expect(c.dynamics.rudderJam).toBeCloseTo(0.4, 1);
    c.dynamics.setRudderOrder(-1);
    for (let i = 0; i < 120; i++) c.dynamics.step(1 / 60);
    expect(c.dynamics.rudder).toBeCloseTo(0.4, 1);

    // She strikes her colours: engines stopped.
    c.damage.status = 'struck';
    c.step(1 / 60, 3, [true]);
    expect(c.dynamics.telegraph).toBe(0);
    expect(c.dynamics.powerFactor).toBe(0);
    expect(c.damage.speedFactor).toBe(0);
  });

  it('wrecked turrets are switched off in her battery and slow crews reload more slowly', () => {
    const c = make();
    c.damage.turrets.find((t) => t.id === 'A')!.state = 'destroyed';
    c.damage.turrets.find((t) => t.id === 'X')!.crew = 0.5;
    c.step(1 / 60, 1, [false]);
    const status = c.main.battery.status();
    expect(status.find((s) => s.id === 'A')!.enabled).toBe(false);
    expect(status.find((s) => s.id === 'P')!.enabled).toBe(true);
    expect(c.damage.turretReloadFactor('X')).toBeCloseTo(2, 3);
  });

  it('the pre-dreadnought has two batteries with separate guns', () => {
    const c = make(PRE_DREADNOUGHT_SETUP);
    expect(c.batteries.length).toBe(2);
    expect(c.batteries[0]!.setup.gun.boreMm).toBe(280);
    expect(c.batteries[1]!.setup.gun.boreMm).toBe(172);
    expect(c.batteries[1]!.gunnery.battery.turrets.length).toBe(12);
  });
});
