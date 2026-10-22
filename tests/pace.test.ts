import { describe, expect, it } from 'vitest';
import { KAISER_SETUP, QUEEN_ELIZABETH_SETUP } from '../src/data/ships/fleet';
import { QUEEN_ELIZABETH } from '../src/data/ships/queen-elizabeth';
import { AGGRESSIVE, HIGH_SEAS_FLEET } from '../src/sim/combat/ai';
import { CALM } from '../src/sim/gunnery/ballistics';
import { Gunnery, REAL_PLOT, type Contact } from '../src/sim/gunnery/gunnery';
import { GUN_15_42_MK_I } from '../src/sim/gunnery/guns';
import { mountsFromSpec } from '../src/sim/gunnery/mounts';
import { ARCADE, pacedProfile, pacedSetup, paceById, REAL } from '../src/sim/pace';
import { Rng } from '../src/sim/rng';
import { handlingFor, KNOT, ShipDynamics } from '../src/sim/ships/dynamics';
import type { ShipFrame } from '../src/sim/ships/frame';

const handlingOf = (setup: typeof QUEEN_ELIZABETH_SETUP) => handlingFor(setup.ship.hull.length, setup.maxSpeedKn, setup.handling);

describe('pace', () => {
  it('knows the real pace and the arcade one, and falls back to the real', () => {
    expect(paceById('arcade')).toBe(ARCADE);
    expect(paceById('real')).toBe(REAL);
    expect(paceById('nonsense')).toBe(REAL);
    expect(paceById(null)).toBe(REAL);
  });

  it('leaves a setup alone at the real pace', () => {
    expect(pacedSetup(QUEEN_ELIZABETH_SETUP, REAL)).toBe(QUEEN_ELIZABETH_SETUP);
    expect(pacedProfile(AGGRESSIVE, REAL)).toBe(AGGRESSIVE);
  });

  it('winds on the ship: faster, quicker to build way, a tighter circle and a faster rudder', () => {
    const real = handlingOf(QUEEN_ELIZABETH_SETUP);
    const arcade = pacedSetup(QUEEN_ELIZABETH_SETUP, ARCADE);
    const fast = handlingOf(arcade);
    expect(arcade.maxSpeedKn).toBeCloseTo(24 * ARCADE.speed, 6);
    expect(fast.accelSeconds).toBeLessThan(real.accelSeconds / 2);
    expect(fast.rudderRateDegPerSec).toBeGreaterThan(real.rudderRateDegPerSec * 2);
    expect(fast.turnRadiusLengths).toBeLessThan(real.turnRadiusLengths * 0.6);
    // What the class set for itself is the base, not the reference battleship's: Queen Elizabeth's circle was 1.5 lengths.
    expect(fast.turnRadiusLengths).toBeCloseTo(1.5 / ARCADE.turning, 6);
  });

  it('turns the ship through a right angle in less than half the time', () => {
    const quarterTurn = (setup: typeof QUEEN_ELIZABETH_SETUP) => {
      const d = new ShipDynamics(handlingOf(setup));
      d.setTelegraph(3);
      d.speed = d.orderedSpeed;
      d.setRudderOrder(1);
      let t = 0;
      while (d.heading < Math.PI / 2 && t < 600) {
        d.step(1 / 60);
        t += 1 / 60;
      }
      return t;
    };
    const real = quarterTurn(QUEEN_ELIZABETH_SETUP);
    const arcade = quarterTurn(pacedSetup(QUEEN_ELIZABETH_SETUP, ARCADE));
    expect(arcade).toBeLessThan(real / 2);
    expect(arcade).toBeGreaterThan(3);
  });

  it('quickens the guns without touching the gun the data file holds', () => {
    const reload = GUN_15_42_MK_I.reloadSeconds;
    const train = GUN_15_42_MK_I.trainRateDegPerSec;
    const arcade = pacedSetup(QUEEN_ELIZABETH_SETUP, ARCADE);
    const main = arcade.batteries.find((b) => b.id === 'main')!.gun;
    expect(main.reloadSeconds).toBeCloseTo(reload / ARCADE.reload, 6);
    expect(main.trainRateDegPerSec).toBeCloseTo(train * ARCADE.slew, 6);
    expect(main.shell).toBe(GUN_15_42_MK_I.shell);
    expect(GUN_15_42_MK_I.reloadSeconds).toBe(reload);
    expect(GUN_15_42_MK_I.trainRateDegPerSec).toBe(train);
    expect(QUEEN_ELIZABETH_SETUP.maxSpeedKn).toBe(24);
  });

  it('speeds the torpedoes and the tubes, and the rangefinder reads truer', () => {
    const arcade = pacedSetup(QUEEN_ELIZABETH_SETUP, ARCADE);
    expect(arcade.torpedo!.settings[0]!.speed).toBeCloseTo(QUEEN_ELIZABETH_SETUP.torpedo!.settings[0]!.speed * ARCADE.torpedoes, 6);
    expect(arcade.torpedo!.settings[0]!.range).toBe(QUEEN_ELIZABETH_SETUP.torpedo!.settings[0]!.range);
    expect(arcade.tubes![0]!.reloadSeconds).toBeLessThan(QUEEN_ELIZABETH_SETUP.tubes![0]!.reloadSeconds);
    expect(arcade.rangefinder.angularError).toBeLessThan(QUEEN_ELIZABETH_SETUP.rangefinder.angularError);
    expect(arcade.rangefinder.baseM).toBe(QUEEN_ELIZABETH_SETUP.rangefinder.baseM);
  });

  it('brings the captains in close, and has them jink and decide faster', () => {
    const p = pacedProfile(HIGH_SEAS_FLEET, ARCADE);
    expect(p.rangeMax).toBeCloseTo(HIGH_SEAS_FLEET.rangeMax * ARCADE.engagement, 6);
    expect(p.rangeMin).toBeLessThan(HIGH_SEAS_FLEET.rangeMin);
    expect(p.jinkPeriod).toBeLessThan(HIGH_SEAS_FLEET.jinkPeriod);
    expect(p.thinkPeriod).toBeLessThan(HIGH_SEAS_FLEET.thinkPeriod);
    expect(p.rangeMin).toBeGreaterThan(0);
  });

  it('paces the enemy ship by the same transform', () => {
    const k = pacedSetup(KAISER_SETUP, ARCADE);
    expect(k.maxSpeedKn).toBeGreaterThan(KAISER_SETUP.maxSpeedKn);
    expect(k.plot).toBe(ARCADE.plot);
    expect(KAISER_SETUP.plot).toBeUndefined();
  });
});

describe('the plotting table at arcade pace', () => {
  const mounts = mountsFromSpec(QUEEN_ELIZABETH).filter((m) => ['A', 'B', 'X', 'Y'].includes(m.id));
  const ship: ShipFrame = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0 };

  /** Seconds until the table calls a steady target's plot settled, 120 if it never does. */
  const settleTime = (setup: typeof QUEEN_ELIZABETH_SETUP, seed: number): number => {
    const g = new Gunnery({ gun: setup.batteries[0]!.gun, mounts, rng: new Rng(seed), shooterId: 1, env: CALM, rangefinder: setup.rangefinder, visibilityKm: 30, directorHeight: 29, solvePeriod: 0.5, plot: setup.plot });
    const target: Contact = { id: 2, name: 'T', x: 6000, z: 0, vx: 0, vz: -15 * KNOT, heading: 0, halfLength: 85, halfBeam: 13, draft: 8, height: 20, topHeight: 40, deckHeight: 8 };
    g.contacts.push(target);
    g.designate(target);
    for (let t = 0; t < 120 * 60; t++) {
      const now = t / 60;
      target.z += target.vz / 60;
      g.update(1 / 60, now, ship, false);
      if (t % 30 === 0 && g.status(ship).quality === 'settled') return now;
    }
    return 120;
  };

  it('settles in about half the time, and still gets the target’s speed about right', () => {
    const real = [1, 2, 3, 4, 5].map((s) => settleTime(QUEEN_ELIZABETH_SETUP, s));
    const arcade = [1, 2, 3, 4, 5].map((s) => settleTime(pacedSetup(QUEEN_ELIZABETH_SETUP, ARCADE), s));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(arcade)).toBeLessThan(mean(real) * 0.65);
    expect(Math.max(...arcade)).toBeLessThan(60);
  });

  it('keeps the real table’s timing as the default', () => {
    expect(REAL_PLOT.rangingPeriod).toBe(2);
    expect(ARCADE.plot.rangingPeriod).toBeLessThan(REAL_PLOT.rangingPeriod);
    expect(ARCADE.plot.window).toBeLessThan(REAL_PLOT.window);
  });
});
