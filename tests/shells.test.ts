import { describe, expect, it } from 'vitest';
import { DREADNOUGHT_SETUP, QUEEN_ELIZABETH_SETUP } from '../src/data/ships/fleet';
import { QUEEN_ELIZABETH } from '../src/data/ships/queen-elizabeth';
import { Combatant } from '../src/sim/combat/combatant';
import type { ShipSetup } from '../src/sim/combat/setup';
import { throughPlate } from '../src/sim/damage/penetration';
import { CALM } from '../src/sim/gunnery/ballistics';
import { Gunnery } from '../src/sim/gunnery/gunnery';
import { GUN_12_45_MK_X, GUN_12_PDR, GUN_15_42_MK_I, GUN_24_HOWITZER, GUN_6_45 } from '../src/sim/gunnery/guns';
import { mountsFromSpec } from '../src/sim/gunnery/mounts';
import { RANGEFINDER_9FT } from '../src/sim/gunnery/rangefinder';
import { hasShellChoice, HE_ARMOUR, heShell, shellKind, shellOf } from '../src/sim/gunnery/shells';
import type { ImpactInfo, LiveShell } from '../src/sim/gunnery/shell-world';
import { Rng } from '../src/sim/rng';
import { battleshipHandling, ShipDynamics } from '../src/sim/ships/dynamics';
import type { ShipFrame } from '../src/sim/ships/frame';
import type { ShellSpec } from '../src/sim/gunnery/ballistics';

const DEG = Math.PI / 180;
const AP = GUN_12_45_MK_X.shell;
const HE = heShell(AP);

describe('the two rounds', () => {
  it('knows armour-piercing from high-explosive, and an impact-fuzed round is the second', () => {
    expect(shellKind(AP)).toBe('ap');
    expect(shellKind(HE)).toBe('he');
    expect(shellKind(GUN_6_45.shell)).toBe('he');
    expect(shellKind(GUN_12_PDR.shell)).toBe('he');
  });

  it('flies the same as armour-piercing: the same weight, speed and drag, so the same firing table', () => {
    expect(HE.massKg).toBe(AP.massKg);
    expect(HE.diameterM).toBe(AP.diameterM);
    expect(HE.muzzleVelocity).toBe(AP.muzzleVelocity);
    expect(HE.formFactor).toBe(AP.formFactor);
  });

  it('carries more than twice the explosive, bursts on contact and defeats less armour', () => {
    expect(HE.fillerKg!).toBeGreaterThan(2 * (AP.fillerKg ?? AP.massKg * 0.05));
    expect(HE.fuze).toBe('impact');
    expect(HE.armour).toBe(HE_ARMOUR);
    expect(AP.armour).toBeUndefined();
  });

  it('is the same object each time for the same shell, and leaves the gun in the data file alone', () => {
    expect(heShell(AP)).toBe(heShell(AP));
    expect(GUN_12_45_MK_X.shell.fuze).toBeUndefined();
    expect(GUN_12_45_MK_X.shell.kind).toBeUndefined();
  });

  it('is offered only to the heavy guns that fire an armour-piercing shell', () => {
    expect(hasShellChoice(GUN_12_45_MK_X)).toBe(true);
    expect(hasShellChoice(GUN_15_42_MK_I)).toBe(true);
    expect(hasShellChoice(GUN_6_45)).toBe(false);
    expect(hasShellChoice(GUN_12_PDR)).toBe(false);
    expect(hasShellChoice(GUN_24_HOWITZER)).toBe(false);
    expect(shellOf(GUN_12_45_MK_X, 'he')).toBe(HE);
    expect(shellOf(GUN_12_45_MK_X, 'ap')).toBe(AP);
    expect(shellOf(GUN_6_45, 'he')).toBe(GUN_6_45.shell);
  });
});

describe('armour', () => {
  it('stops a thin-walled round on plate an armour-piercing shell gets through', () => {
    // 150 mm at 5 km: the 12-inch AP shell, arriving at about 600 m/s, defeats it; the same shell as HE does not.
    expect(throughPlate(600, AP.massKg, 305, 150, 0.95).outcome).toBe('penetrate');
    expect(throughPlate(600, AP.massKg, 305, 150, 0.95, HE_ARMOUR).outcome).toBe('shatter');
    // Light structure is no obstacle to either.
    expect(throughPlate(600, AP.massKg, 305, 20, 0.95, HE_ARMOUR).outcome).toBe('penetrate');
  });
});

function make(setup: ShipSetup = DREADNOUGHT_SETUP, seed = 1): Combatant {
  const dynamics = new ShipDynamics(battleshipHandling(setup.ship.hull.length, setup.maxSpeedKn));
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

const live = (spec: ShellSpec): LiveShell => ({ id: 1, salvo: 1, shooter: 99, spec, state: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 }, passed: [], prevX: 0, prevY: 0, prevZ: 0 });

/** A step of a shell travelling west (-x) at `speed`, descending at `descent` degrees, reaching x = `atX` at height y. */
function stepWest(spec: ShellSpec, atX: number, y: number, z: number, speed: number, descent: number): ImpactInfo {
  const a = descent * DEG;
  const vx = -Math.cos(a) * speed;
  const vy = -Math.sin(a) * speed;
  const dt = 1 / 60;
  return { shell: live(spec), from: [atX - vx * dt, y - vy * dt, z], to: [atX, y, z], velocity: [vx, vy, 0] };
}

describe('the two rounds against a ship', () => {
  it('armour-piercing gets through the belt at short range and bursts inside; high-explosive breaks up on it', () => {
    const ap = make();
    expect(ap.resolveHit(stepWest(AP, 10.8, 0.4, -30, 700, 2))?.kind).toBe('burst');
    const he = make();
    expect(he.resolveHit(stepWest(HE, 10.8, 0.4, -30, 700, 2))?.kind).toBe('shatter');
    expect(he.hitsTaken).toBe(0);
  });

  it('breaking up on the belt hurts more with high-explosive: the blast and splinters are heavier', () => {
    // Long range, so both break up: the armour-piercing shell and the high-explosive one, same place, same speed.
    const crewLost = (spec: ShellSpec): number => {
      const c = make();
      for (let i = 0; i < 40; i++) c.resolveHit(stepWest(spec, 10.8, 0.4, -30 + i * 1.5, 430, 9));
      return c.damage.comps.reduce((s, x) => s + (1 - x.crew), 0);
    };
    expect(crewLost(HE)).toBeGreaterThan(crewLost(AP) * 1.5);
  });

  it('high-explosive bursts in the funnel where armour-piercing flies through', () => {
    // Through the top of the forward funnel: the armour-piercing shell goes out the other side (see combatant.test).
    const ap = make();
    expect(ap.resolveHit(stepWest(AP, 1.5, 12.8, -26, 600, 3))?.kind).toBe('pass');
    const he = make();
    const hit = he.resolveHit(stepWest(HE, 1.5, 12.8, -26, 600, 3));
    expect(hit?.kind).toBe('burst');
    expect(hit?.consumed).toBe(true);
    expect(he.hitsTaken).toBe(1);
  });
});

describe('choosing the round', () => {
  const mounts = mountsFromSpec(QUEEN_ELIZABETH).filter((m) => ['A', 'B', 'X', 'Y'].includes(m.id));
  const ship: ShipFrame = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0 };
  const gunnery = (gun = GUN_15_42_MK_I): Gunnery => new Gunnery({ gun, mounts, rng: new Rng(4), shooterId: 1, env: CALM, rangefinder: RANGEFINDER_9FT, visibilityKm: 30, directorHeight: 29 });

  it('starts with armour-piercing, and a gun with no choice stays with its own', () => {
    const g = gunnery();
    expect(g.shell).toBe('ap');
    expect(g.shellChoice).toBe(true);
    expect(g.status(ship).shell).toBe('ap');
    const small = gunnery(GUN_6_45);
    expect(small.shellChoice).toBe(false);
    small.setShell('he');
    expect(small.shell).toBe('ap');
  });

  it('fires the shell that was loaded when the salvo began, whatever is chosen while it is in the air', () => {
    const g = gunnery();
    const target = { id: 2, name: 'T', x: 6000, z: 0, vx: 0, vz: 0, heading: 0, halfLength: 100, halfBeam: 14, draft: 8, height: 20, topHeight: 40, deckHeight: 8 };
    g.contacts.push(target);
    g.designate(target);
    g.setShell('he');
    const kindsInAir = new Set<string>();
    const bySalvo = new Map<number, Set<string>>();
    for (let t = 0; t < 60 * 150 && !(kindsInAir.has('he') && kindsInAir.has('ap')); t++) {
      g.update(1 / 60, t / 60, ship, true);
      for (const s of g.world.shells) {
        kindsInAir.add(shellKind(s.spec));
        (bySalvo.get(s.salvo) ?? bySalvo.set(s.salvo, new Set()).get(s.salvo)!).add(shellKind(s.spec));
      }
      // Changed while the first salvo is still in the air, or being loaded for: the first goes as it was loaded.
      if (kindsInAir.has('he') && g.shell === 'he') g.setShell('ap');
    }
    // The first salvo went as high-explosive; the one begun after the change went as armour-piercing.
    expect(kindsInAir.has('he')).toBe(true);
    expect(kindsInAir.has('ap')).toBe(true);
    expect(g.shell).toBe('ap');
    // No salvo was ever part one kind and part the other, though the choice was made while the first was still leaving the guns.
    expect(bySalvo.size).toBeGreaterThanOrEqual(2);
    for (const kinds of bySalvo.values()) expect(kinds.size).toBe(1);
  });
});

describe('the Queen Elizabeth\'s main guns', () => {
  it('have the choice, and her casemates do not', () => {
    const [main, secondary] = QUEEN_ELIZABETH_SETUP.batteries;
    expect(hasShellChoice(main!.gun)).toBe(true);
    expect(hasShellChoice(secondary!.gun)).toBe(false);
  });
});
