import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { shipBasis } from '../src/render/ships/pose-matrix';
import { ShipRig } from '../src/render/ships/rig';
import { CALM, flyToSea, launch, solveElevation, type Environment } from '../src/sim/gunnery/ballistics';
import {
  angleInArc,
  GunBattery,
  GUN_STAGGER_SECONDS,
  muzzleShipSpace,
  RIPPLE_SECONDS,
} from '../src/sim/gunnery/battery';
import { Gunnery, type Contact } from '../src/sim/gunnery/gunnery';
import { GUN_12_45_MK_X } from '../src/sim/gunnery/guns';
import { mountsFromModel, mountsFromSpec } from '../src/sim/gunnery/mounts';
import { RANGEFINDER_9FT } from '../src/sim/gunnery/rangefinder';
import { segmentHitsBox, ShellWorld, type HitBox } from '../src/sim/gunnery/shell-world';
import { Rng } from '../src/sim/rng';
import { shipPointToWorld, type ShipFrame } from '../src/sim/ships/frame';

const DEG = Math.PI / 180;
const KNOT = 0.514444;
const model = buildShip(DREADNOUGHT);
const allMounts = mountsFromModel(model);
/** The five main turrets: the guns these tests are about. */
const mounts = allMounts.filter((m) => ['A', 'P', 'Q', 'X', 'Y'].includes(m.id));

const frame = (over: Partial<ShipFrame> = {}): ShipFrame => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0, ...over });

describe('ship frame', () => {
  it('agrees with the renderer\'s ship basis for any heading, pitch and roll', () => {
    const cases = [
      { headingDeg: 0, pitch: 0, roll: 0 },
      { headingDeg: 90, pitch: 0.05, roll: -0.08 },
      { headingDeg: 213, pitch: -0.03, roll: 0.1 },
    ];
    for (const c of cases) {
      const basis = shipBasis({ x: 100, z: -50, heave: 1.5, ...c });
      const local: [number, number, number] = [30, 12, -6];
      const w = shipPointToWorld(frame({ x: 100, y: 1.5, z: -50, heading: c.headingDeg * DEG, pitch: c.pitch, roll: c.roll }), local);
      const expected = [
        100 + basis.forward[0] * 30 + basis.up[0] * 12 + basis.starboard[0] * -6,
        1.5 + basis.forward[1] * 30 + basis.up[1] * 12 + basis.starboard[1] * -6,
        -50 + basis.forward[2] * 30 + basis.up[2] * 12 + basis.starboard[2] * -6,
      ];
      for (let i = 0; i < 3; i++) expect(w[i]!).toBeCloseTo(expected[i]!, 9);
    }
  });
});

describe('turret mounts', () => {
  it('muzzle positions match what the rig actually draws', () => {
    const rig = new ShipRig(model);
    model.turrets.forEach((t, ti) => {
      const mount = allMounts[ti]!;
      for (const [trainDeg, elevDeg] of [
        [0, 0],
        [35, 10],
        [-120, 13.5],
        [180, 5],
      ] as const) {
        rig.setTurret(t.id, trainDeg * DEG, elevDeg * DEG);
        rig.update();
        t.barrelNodes.forEach((node, g) => {
          const m = rig.matrices.subarray(node * 16, node * 16 + 16);
          const p = [t.trunnions[g]![0] + t.muzzleOffset[0], t.trunnions[g]![1], t.trunnions[g]![2]];
          const drawn = [
            m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
            m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
            m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
          ];
          const mine = muzzleShipSpace(mount, g, trainDeg * DEG, elevDeg * DEG);
          for (let i = 0; i < 3; i++) expect(mine[i]!).toBeCloseTo(drawn[i]!, 3);
        });
      }
    });
  });

  it('mounts computed from the spec alone are the mounts of the built model', () => {
    expect(mountsFromSpec(DREADNOUGHT)).toEqual(allMounts);
  });

  it('training arcs give the Dreadnought its eight-gun broadside, six ahead and four astern', () => {
    const battery = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(1));
    const gunsBearing = (relDeg: number) => {
      battery.order(relDeg * DEG, 0, 0);
      return battery.bearingGuns;
    };
    expect(gunsBearing(90)).toBe(8); // starboard beam: A, Q, X, Y
    expect(gunsBearing(-90)).toBe(8); // port beam: A, P, X, Y
    expect(gunsBearing(0)).toBe(6); // A, P, Q
    expect(gunsBearing(180)).toBe(4); // X, Y
  });

  it('arc arithmetic wraps correctly', () => {
    expect(angleInArc(200 * DEG, -150 * DEG, 150 * DEG)).toBeNull();
    expect(angleInArc(350 * DEG, -150 * DEG, 150 * DEG)! / DEG).toBeCloseTo(-10, 6);
    expect(angleInArc(-170 * DEG, 60 * DEG, 300 * DEG)! / DEG).toBeCloseTo(190, 6);
    expect(angleInArc(10 * DEG, -20 * DEG, 170 * DEG)! / DEG).toBeCloseTo(10, 6);
  });
});

describe('GunBattery', () => {
  const loadedFraction = (b: GunBattery) => b.status().map((s) => s.loaded);

  it('slews at the gun\'s training rate and will not fire until it is on', () => {
    const b = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(2));
    b.order(60 * DEG, 5 * DEG, 0);
    const turret = (id: string) => b.turrets.find((t) => t.mount.id === id)!;
    for (let i = 0; i < 60 * 10; i++) b.update(1 / 60, frame(), true);
    // After ten seconds A has turned 45 degrees from ahead, X has turned 45 degrees from astern toward the beam.
    expect(turret('A').train / DEG).toBeCloseTo(45, 0);
    expect(turret('X').train / DEG).toBeCloseTo(135, 0);
    let first = -1;
    const azimuths: number[] = [];
    for (let i = 0; i < 60 * 20 && first < 0; i++) {
      const shots = b.update(1 / 60, frame(), true);
      if (shots.length > 0) {
        first = 10 + i / 60;
        azimuths.push(...shots.map((s) => s.azimuth / DEG));
      }
    }
    // A and Q reach 60 degrees at 13.3 s; nothing fires before that.
    expect(first).toBeGreaterThan(13.2);
    for (const az of azimuths) expect(Math.abs(az - 60)).toBeLessThan(0.5);
  });

  it('holds a partial salvo for stragglers, but only for a while', () => {
    const b = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(2));
    b.order(60 * DEG, 5 * DEG, 0);
    const fired = new Set<string>();
    let firstAt = -1;
    for (let i = 0; i < 60 * 40; i++) {
      for (const s of b.update(1 / 60, frame(), true)) {
        if (firstAt < 0) firstAt = i / 60;
        fired.add(mounts[s.turret]!.id);
      }
      if (i / 60 > 40) break;
    }
    // A and Q are on at 13.3 s; X and Y would not be for another 13 s, longer than the 8 s patience, so A and Q go alone.
    expect(firstAt).toBeGreaterThan(20);
    expect(firstAt).toBeLessThan(23);
    expect([...fired].sort()).toEqual(['A', 'Q']);
  });

  it('ripples turrets bow to stern and the barrels of a turret a moment apart', () => {
    const b = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(3));
    b.order(0, 3 * DEG, 0); // dead ahead: A, P, Q bear and are already on
    // Settle elevation.
    for (let i = 0; i < 60; i++) b.update(1 / 60, frame(), false);
    const times: { turret: number; gun: number; t: number }[] = [];
    let t = 0;
    for (let i = 0; i < 240; i++) {
      for (const s of b.update(1 / 60, frame(), true)) times.push({ turret: s.turret, gun: s.gun, t });
      t += 1 / 60;
    }
    expect(times.length).toBe(6);
    const byTurret = (id: string) => times.filter((x) => mounts[x.turret]!.id === id);
    const first = byTurret('A');
    expect(first.length).toBe(2);
    expect(first[1]!.t - first[0]!.t).toBeGreaterThan(GUN_STAGGER_SECONDS - 0.03);
    // A is furthest forward: it fires before P and Q.
    expect(Math.min(...byTurret('P').map((x) => x.t))).toBeGreaterThan(Math.max(...first.map((x) => x.t)) - 0.02);
    const span = Math.max(...times.map((x) => x.t)) - Math.min(...times.map((x) => x.t));
    expect(span).toBeGreaterThan(RIPPLE_SECONDS);
    expect(span).toBeLessThan(RIPPLE_SECONDS * 3);
  });

  it('reloads in about the gun\'s reload time and then fires again while the trigger is held', () => {
    const b = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(4));
    b.order(0, 3 * DEG, 0);
    for (let i = 0; i < 60; i++) b.update(1 / 60, frame(), false);
    const salvoTimes: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 70; i++) {
      const shots = b.update(1 / 60, frame(), true);
      if (shots.some((s) => s.gun === 0 && mounts[s.turret]!.id === 'A')) salvoTimes.push(t);
      t += 1 / 60;
    }
    expect(salvoTimes.length).toBeGreaterThanOrEqual(3);
    const gap = salvoTimes[1]! - salvoTimes[0]!;
    expect(gap).toBeGreaterThan(24);
    expect(gap).toBeLessThan(29);
    // While reloading, the turrets show it.
    const b2 = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(5));
    b2.order(0, 0, 0);
    b2.fireAll();
    b2.update(1, frame(), false);
    expect(Math.max(...loadedFraction(b2))).toBeLessThan(0.1);
  });

  it('shots leave from the barrels, at the ordered angles plus scatter, carrying the ship\'s motion', () => {
    const b = new GunBattery(mounts, GUN_12_45_MK_X, new Rng(6));
    b.order(0, 8 * DEG, 0);
    for (let i = 0; i < 180; i++) b.update(1 / 60, frame({ vx: 0, vz: -8 }), false);
    const shots: ReturnType<GunBattery['update']> = [];
    for (let i = 0; i < 200; i++) shots.push(...b.update(1 / 60, frame({ x: 1000, z: 2000, heading: 0, vz: -8 }), true));
    expect(shots.length).toBe(6);
    for (const s of shots) {
      expect(Math.abs(s.azimuth)).toBeLessThan(0.3 * DEG);
      expect(Math.abs(s.elevation - 8 * DEG)).toBeLessThan(0.3 * DEG);
      expect(s.shipVz).toBe(-8);
      expect(s.muzzle[0]).toBeGreaterThan(1000 - 20);
      expect(s.muzzle[0]).toBeLessThan(1000 + 20);
      expect(s.muzzle[1]).toBeGreaterThan(6);
      expect(s.muzzle[1]).toBeLessThan(14);
      expect(Math.hypot(...s.direction)).toBeCloseTo(1, 6);
    }
    // A fires from the bow end: its muzzle is well north (smaller z) of the ship's centre.
    const a = shots.find((s) => mounts[s.turret]!.id === 'A')!;
    expect(a.muzzle[2]).toBeLessThan(2000 - 55);
  });
});

describe('ShellWorld', () => {
  const box: HitBox = { id: 2, x: 0, z: -1000, heading: 90 * DEG, halfLength: 80, halfBeam: 12.5, draft: 8, height: 16 };

  it('hits a ship box along its own axes, wherever the ship points', () => {
    // Heading east: the long axis runs along x. A shot along z at x = 60 crosses the hull; at x = 100 it misses.
    expect(segmentHitsBox(60, 30, -1100, 60, -2, -900, box)).not.toBeNull();
    expect(segmentHitsBox(100, 30, -1100, 100, -2, -900, box)).toBeNull();
    // Passing over the funnels.
    expect(segmentHitsBox(0, 40, -1100, 0, 30, -900, box)).toBeNull();
    // A very long step cannot tunnel through.
    expect(segmentHitsBox(0, 8, -1500, 0, 8, -500, box)).not.toBeNull();
    // The entry point is on the near face with box-local coordinates.
    const hit = segmentHitsBox(10, 10, -1100, 10, 10, -900, box)!;
    expect(hit.z).toBeCloseTo(-1012.5, 6);
    expect(hit.lz).toBeCloseTo(-12.5, 6);
  });

  it('a shell fired at the sea splashes where flyToSea says it will, and a shell at a ship hits it', () => {
    const spec = GUN_12_45_MK_X.shell;
    const world = new ShellWorld(CALM);
    const el = solveElevation(spec, 9000, 13.5 * DEG)!;
    const fire = (az: number) =>
      world.spawn({ salvo: 1, turret: 0, gun: 0, muzzle: [0, 12, 0], azimuth: az, elevation: el, velocityScale: 1, shipVx: 0, shipVz: 0, direction: [0, 0, -1] }, spec, 1);
    const expected = flyToSea(launch(spec, [0, 12, 0], 0, el), spec, CALM, 1 / 60)!;
    fire(0);
    const events = [];
    for (let i = 0; i < 60 * 60 && world.shells.length > 0; i++) events.push(...world.step(1 / 60, []));
    expect(events.length).toBe(1);
    const splash = events[0]!;
    expect(splash.kind).toBe('splash');
    expect(Math.abs(splash.x - expected.x)).toBeLessThan(1);
    expect(Math.abs(splash.z - expected.z)).toBeLessThan(2);
    expect(splash.angleDeg).toBeGreaterThan(3);

    // Same shot with a ship at the aim point.
    const target: HitBox = { id: 2, x: 0, z: expected.z, heading: 90 * DEG, halfLength: 80, halfBeam: 12.5, draft: 8, height: 16 };
    fire(0);
    const ev2 = [];
    for (let i = 0; i < 60 * 60 && world.shells.length > 0; i++) ev2.push(...world.step(1 / 60, [target]));
    expect(ev2.length).toBe(1);
    expect(ev2[0]!.kind).toBe('hit');
    // The shooter's own ship is never hit by its shells.
    fire(0);
    const own: HitBox = { ...target, id: 1 };
    const ev3 = [];
    for (let i = 0; i < 60 * 60 && world.shells.length > 0; i++) ev3.push(...world.step(1 / 60, [own]));
    expect(ev3[0]!.kind).toBe('splash');
  });
});

describe('Gunnery (the whole chain)', () => {
  const TRUE_ENV: Environment = { windX: 6, windZ: 3, coriolisLatitudeDeg: 52, densityScale: 1 };

  function makeTarget(x: number, z: number, speedKn = 0, courseDeg = 0): Contact & { course: number } {
    const course = courseDeg * DEG;
    return {
      id: 2,
      name: 'Target',
      x,
      z,
      vx: Math.sin(course) * speedKn * KNOT,
      vz: -Math.cos(course) * speedKn * KNOT,
      heading: course,
      halfLength: 80,
      halfBeam: 12.5,
      draft: 8,
      height: 16,
      topHeight: 38,
      deckHeight: 5.5,
      course,
    };
  }

  /** A gunnery bot: designate, wait for the plot to settle, hold the trigger, let the auto-spotter correct. */
  function salvosToFirstHit(seed: number, range: number, relBearingDeg: number, targetSpeedKn = 0): { salvos: number; seconds: number } {
    const rng = new Rng(seed);
    const own = { x: 0, z: 0, heading: 0, speed: 8 * KNOT };
    const brg = relBearingDeg * DEG;
    const target = makeTarget(Math.sin(brg) * range, -Math.cos(brg) * range, targetSpeedKn, 90);
    const g = new Gunnery({
      gun: GUN_12_45_MK_X,
      mounts,
      rng,
      shooterId: 1,
      env: TRUE_ENV,
      rangefinder: RANGEFINDER_9FT,
      visibilityKm: 40,
      directorHeight: 24,
    });
    g.contacts.push(target);
    g.autoSpot = true;
    g.designate(target);
    let salvosFired = 0;
    let firstHit = 0;
    g.onReport = (r) => {
      if (r.hits > 0 && firstHit === 0) firstHit = r.salvo;
    };
    const dt = 1 / 60;
    let t = 0;
    for (; t < 60 * 12 && firstHit === 0; t += dt) {
      own.x += Math.sin(own.heading) * own.speed * dt;
      own.z -= Math.cos(own.heading) * own.speed * dt;
      target.x += target.vx * dt;
      target.z += target.vz * dt;
      const ship = frame({ x: own.x, z: own.z, heading: own.heading, vx: Math.sin(own.heading) * own.speed, vz: -Math.cos(own.heading) * own.speed });
      const status = g.status(ship);
      const go = status.quality === 'settled' || (status.quality === 'settling' && t > 50);
      g.update(dt, t, ship, go);
      salvosFired = g.battery.drainStartedSalvos().length + salvosFired;
    }
    return { salvos: firstHit === 0 ? 99 : firstHit, seconds: t };
  }

  it('designating a contact plots it, solves it and trains the guns onto it', () => {
    const g = new Gunnery({ gun: GUN_12_45_MK_X, mounts, rng: new Rng(9), shooterId: 1, env: CALM, rangefinder: RANGEFINDER_9FT, visibilityKm: 40, directorHeight: 24 });
    const target = makeTarget(11276, -4104);
    g.contacts.push(target);
    g.designate(target);
    const ship = frame();
    for (let t = 0; t < 30; t += 1 / 60) g.update(1 / 60, t, ship, false);
    const s = g.status(ship);
    expect(s.target!.range).toBeGreaterThan(11500);
    expect(s.target!.range).toBeLessThan(12500);
    expect(s.target!.relativeBearingDeg).toBeCloseTo(70, 0);
    expect(s.solution?.valid).toBe(true);
    // The eight guns that bear are on their way to the right bearing.
    const bearing = g.battery.turrets.filter((t) => t.bears);
    expect(bearing.length).toBe(4);
    for (const t of bearing) expect(Math.abs(t.orderedTrain - 70 * DEG)).toBeLessThan(2 * DEG);
  });

  it('a target beyond the horizon cannot be plotted, and one in haze neither', () => {
    const g = new Gunnery({ gun: GUN_12_45_MK_X, mounts, rng: new Rng(10), shooterId: 1, env: CALM, rangefinder: RANGEFINDER_9FT, visibilityKm: 8, directorHeight: 24 });
    const target = makeTarget(0, -12000);
    g.contacts.push(target);
    g.designate(target);
    for (let t = 0; t < 30; t += 1 / 60) g.update(1 / 60, t, frame(), false);
    expect(g.track.count).toBe(0);
    expect(g.status(frame()).quality).toBe('lost');
  });

  it('notices a target that turns, replots, and settles on the new course', () => {
    const rng = new Rng(42);
    const g = new Gunnery({ gun: GUN_12_45_MK_X, mounts, rng, shooterId: 1, env: CALM, rangefinder: RANGEFINDER_9FT, visibilityKm: 40, directorHeight: 24 });
    // 10 km on the starboard bow, steaming east at 12 knots; at t = 100 s it turns to the south-east... then north-east.
    const target = makeTarget(5000, -8660, 12, 90);
    g.contacts.push(target);
    g.designate(target);
    const ship = frame();
    const speed = 12 * KNOT;
    const qualities: { t: number; q: string; courseDeg: number | null }[] = [];
    for (let i = 0; i < 260 * 60; i++) {
      const t = i / 60;
      const course = t < 100 ? 90 * DEG : 0 * DEG; // a 90-degree turn to north, taken at once
      target.vx = Math.sin(course) * speed;
      target.vz = -Math.cos(course) * speed;
      target.heading = course;
      target.x += target.vx / 60;
      target.z += target.vz / 60;
      g.update(1 / 60, t, ship, false);
      if (i % 300 === 0) {
        const s = g.status(ship);
        qualities.push({ t: i / 60, q: s.quality, courseDeg: s.estimate ? s.estimate.courseDeg : null });
      }
    }
    const at = (t: number) => qualities.find((x) => x.t === t)!;
    // Before the turn the plot is settled on a course of about 090.
    expect(at(95).q).toBe('settled');
    expect(Math.abs(at(95).courseDeg! - 90)).toBeLessThan(8);
    // Shortly after the turn, the table knows it no longer fits.
    const flagged = qualities.filter((x) => x.t > 100 && x.t <= 150).some((x) => x.q === 'turned');
    expect(flagged).toBe(true);
    // Some time later it has replotted onto roughly north (000 or 360).
    const late = at(255);
    const off = Math.min(late.courseDeg!, 360 - late.courseDeg!);
    expect(off).toBeLessThan(12);
  });

  it('wind and Coriolis the table does not know about are found by the fall of shot', () => {
    const results = Array.from({ length: 20 }, (_, i) => salvosToFirstHit(500 + i * 13, 12000, 70));
    const within4 = results.filter((r) => r.salvos <= 4).length;
    // eslint-disable-next-line no-console
    console.log('bracketing 12 km stationary: salvos', results.map((r) => r.salvos).join(','), 'secs', results.map((r) => Math.round(r.seconds)).join(','));
    expect(within4 / results.length).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
