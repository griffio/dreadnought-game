import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { DREADNOUGHT_DAMAGE } from '../src/data/ships/dreadnought-damage';
import { NELSON } from '../src/data/ships/nelson';
import { NELSON_DAMAGE } from '../src/data/ships/nelson-damage';
import { createIntent, resetLevels } from '../src/input/intent';
import { GamepadSource, type GamepadLike } from '../src/input/gamepad';
import { PointerCameraSource } from '../src/input/pointer-camera';
import { RenderScaleController } from '../src/render/render-scale';
import { buildShip } from '../src/render/ships/forge/build-ship';
import type { Combatant } from '../src/sim/combat/combatant';
import { PlayerBot } from '../src/sim/combat/player-bot';
import { buildHitGeometry, type V3 } from '../src/sim/damage/geometry';
import { ShipDamage } from '../src/sim/damage/ship-damage';
import { traceShell } from '../src/sim/damage/trace';
import { CALM } from '../src/sim/gunnery/ballistics';
import { Gunnery, type Contact } from '../src/sim/gunnery/gunnery';
import { GUN_12_45_MK_X } from '../src/sim/gunnery/guns';
import { mountsFromModel } from '../src/sim/gunnery/mounts';
import { RANGEFINDER_9FT } from '../src/sim/gunnery/rangefinder';
import type { SalvoReport } from '../src/sim/gunnery/spotting';
import { jonswapOmega, peakOmega, type SpectrumParams } from '../src/sim/ocean/spectrum';
import { Rng } from '../src/sim/rng';
import { battleshipHandling, ShipDynamics, TELEGRAPH } from '../src/sim/ships/dynamics';
import type { ShipFrame } from '../src/sim/ships/frame';
import { FixedStepper } from '../src/sim/time';
import { assessTorpedo } from '../src/sim/torpedo/threat';
import type { TorpedoWorld } from '../src/sim/torpedo/world';

// Regression tests for the defects found in the review of 2026-10-23, one per fix, so that none comes back.

const DEG = Math.PI / 180;
const model = buildShip(DREADNOUGHT);
const mounts = mountsFromModel(model).filter((m) => ['A', 'P', 'Q', 'X', 'Y'].includes(m.id));
const frame = (over: Partial<ShipFrame> = {}): ShipFrame => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0, ...over });

function target(x: number, z: number, over: Partial<Contact> = {}): Contact {
  return { id: 2, name: 'Target', x, z, vx: 0, vz: 0, heading: 0, halfLength: 80, halfBeam: 12.5, draft: 8, height: 16, topHeight: 38, deckHeight: 5.5, ...over };
}

function gunnery(seed: number, c: Contact): Gunnery {
  const g = new Gunnery({ gun: GUN_12_45_MK_X, mounts, rng: new Rng(seed), shooterId: 1, env: CALM, rangefinder: RANGEFINDER_9FT, visibilityKm: 40, directorHeight: 24 });
  g.contacts.push(c);
  g.designate(c);
  return g;
}

describe('salvo bookkeeping', () => {
  it('a turret put out of action in the ripple does not leave its salvo waiting for ever: the shells that flew are reported', () => {
    const g = gunnery(3, target(0, -8000));
    const reports: SalvoReport[] = [];
    g.onReport = (r) => reports.push(r);
    let fired = 0;
    g.onShot = () => fired++;
    const ship = frame();
    const dt = 1 / 60;
    let disabledAt: number | null = null;
    let expected = 0;
    for (let t = 0; t < 240; t += dt) {
      g.update(dt, t, ship, disabledAt === null);
      if (disabledAt === null && g.world.shells.length > 0) {
        // The first shell is away and the rest of the ripple is queued: a turret with barrels still to fire is knocked out.
        expected = g.battery.turrets.reduce((n, x) => n + x.mount.trunnions.length, 0);
        const i = g.battery.turrets.findIndex((x) => x.queue.length > 0);
        expect(i).toBeGreaterThanOrEqual(0);
        g.battery.setAvailability(i, false, 1);
        disabledAt = t;
      }
      if (disabledAt !== null && t > disabledAt + 5 && g.world.shells.length === 0) break;
    }
    expect(disabledAt).not.toBeNull();
    expect(fired).toBeLessThan(expected);
    expect(reports.length).toBe(1);
    expect(reports[0]!.shells.length).toBe(fired);
  });

  it('a shell that goes clean through the target is counted once, where it finally falls, and not as a hit', () => {
    // A ship so big that every shell of the salvo reaches her, and so thin that every shell goes through and flies on.
    const c = target(0, -4000, {
      halfLength: 400,
      halfBeam: 300,
      height: 60,
      draft: 10,
      resolveHit: (info) => ({ kind: 'pass', at: info.to, consumed: false, speed: Math.hypot(...info.velocity) * 0.95 }),
    });
    const g = gunnery(5, c);
    const reports: SalvoReport[] = [];
    g.onReport = (r) => reports.push(r);
    let passes = 0;
    let splashes = 0;
    g.onShellEvent = (e) => {
      if (e.kind === 'hit') passes++;
      else if (e.kind === 'splash') splashes++;
    };
    const ship = frame();
    const dt = 1 / 60;
    let begun = false;
    for (let t = 0; t < 240; t += dt) {
      g.update(dt, t, ship, !begun);
      if (g.world.shells.length > 0) begun = true;
      if (begun && reports.length > 0 && g.world.shells.length === 0) break;
    }
    expect(passes).toBeGreaterThan(0);
    expect(splashes).toBeGreaterThan(0);
    // One report for the salvo, made of its splashes: a shell through and out is no hit.
    expect(reports.length).toBe(1);
    expect(reports[0]!.hits).toBe(0);
    expect(reports[0]!.shells.length).toBe(splashes);
  });
});

describe('the player bot and torpedoes', () => {
  function bot(torpedoHeading: number): PlayerBot {
    const dynamics = new ShipDynamics(battleshipHandling(160, 21));
    const me = {
      id: 1,
      x: 0,
      z: 0,
      halfBeam: 12,
      dynamics,
      batteries: [],
      damage: { floating: true },
      main: { target: null, autoSpot: false, designate() {} },
    } as unknown as Combatant;
    // Five hundred metres north of her, seen.
    const torpedoes = { torpedoes: [{ shooter: 2, seenBy: [1], x: 0, z: -500, heading: torpedoHeading, speed: 17, run: 0, maxRun: 4000 }] } as unknown as TorpedoWorld;
    return new PlayerBot(me, () => [], torpedoes, 'head-on');
  }

  it('turns toward a torpedo running at the ship, and ignores one that has gone by', () => {
    const coming = bot(180 * DEG); // running south, at her
    coming.update(0);
    expect(coming.evading).toBe(true);
    const going = bot(0); // running north, away from her
    going.update(0);
    expect(going.evading).toBe(false);
  });
});

describe('the damage model', () => {
  const geomDn = buildHitGeometry(DREADNOUGHT, DREADNOUGHT_DAMAGE);
  const dreadnought = (seed = 1) =>
    new ShipDamage(DREADNOUGHT_DAMAGE, geomDn, new Rng(seed), DREADNOUGHT.turrets.map((t) => t.id), { length: DREADNOUGHT.hull.length, beam: DREADNOUGHT.hull.beam }, DREADNOUGHT.funnels.length);
  const run = (d: ShipDamage, seconds: number, dt = 0.25) => {
    for (let t = 0; t < seconds; t += dt) d.update(dt);
  };

  it('losing one of two engine rooms leaves half the power, not none', () => {
    const geom = buildHitGeometry(NELSON, NELSON_DAMAGE);
    const d = new ShipDamage(NELSON_DAMAGE, geom, new Rng(1), NELSON.turrets.map((t) => t.id), { length: NELSON.hull.length, beam: NELSON.hull.beam }, NELSON.funnels.length);
    expect(d.power).toBeCloseTo(1, 6);
    d.wound({ flooded: [{ comp: 'engine-1', fraction: 1 }] });
    // Each engine room drives half the shafts: one lost (health 0) leaves the other half, where it used to leave nothing.
    expect(d.power).toBeGreaterThan(0.4);
    expect(d.power).toBeLessThan(0.6);
  });

  it('a director shot away is jury-rigged to a tenth and no further, while a damaged one is repaired', () => {
    const gone = dreadnought();
    gone.wound({ fireControl: 0 });
    run(gone, 1500);
    expect(gone.fireControl).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(gone.fireControl).toBeGreaterThan(0.05);
    const hurt = dreadnought();
    hurt.wound({ fireControl: 0.5 });
    run(hurt, 600);
    expect(hurt.fireControl).toBeGreaterThan(0.95);
  });

  it('a hit beyond the stem is in the bow, not the stern', () => {
    const d = dreadnought();
    d.applyTorpedo({ x: 85, side: 1, depth: 3, warheadKg: 200 });
    const texts = d.drainReports().map((r) => r.text.toLowerCase());
    expect(texts.some((t) => t.includes('bow'))).toBe(true);
    expect(texts.some((t) => t.includes('stern'))).toBe(false);
  });

  it('a grounding on the keel floods her without a list', () => {
    const d = dreadnought();
    d.applyGrounding(50, 6);
    run(d, 240);
    expect(d.summary().floodedT).toBeGreaterThan(50);
    expect(Math.abs(d.summary().listDeg)).toBeLessThan(0.2);
  });

  it('the face of a step in the hull is plated: a raking shell meets it instead of passing into the citadel', () => {
    expect(geomDn.plates.some((p) => p.id.includes('.step.'))).toBe(true);
    // From fine on the starboard bow, descending 6 degrees, passing outside the narrow bow compartment and into the beamier magazine
    // compartment through the open face of the step at x = 60 (the bow is 3.3 m wide there, the magazine 8.3 m).
    const a = 6 * DEG;
    const yaw = 4 * DEG;
    const dir: V3 = [-Math.cos(a) * Math.cos(yaw), -Math.sin(a), Math.cos(a) * Math.sin(yaw)];
    const p: V3 = [60, 0.2, 7.5];
    const origin: V3 = [p[0] - dir[0] * 40, p[1] - dir[1] * 40, p[2] - dir[2] * 40];
    const rest = (id: string) => DREADNOUGHT.turrets.find((t) => t.id === id)!.restTrainDeg * DEG;
    const r = traceShell(geomDn, rest, { massKg: 386, diameterMm: 305, speed: 500 }, { origin, dir, segment: 70 });
    expect(r).not.toBeNull();
    expect(r!.first.id).toContain('.step.');
    expect(r!.first.axis).toBe(0);
  });
});

describe('a torpedo that stops inside the hull', () => {
  const own = { x: 0, z: 0, heading: 0, speed: 0, halfLength: 80, halfBeam: 12 };
  it('is a hit, though its closest approach to her centre lies beyond its run', () => {
    const inside = assessTorpedo({ x: 1000, z: -70, heading: 270 * DEG, speed: 17.5, run: 0, maxRun: 995 }, own);
    expect(inside.level).toBe('hit');
    expect(inside.eta).toBeGreaterThan(50);
    const short = assessTorpedo({ x: 1000, z: -70, heading: 270 * DEG, speed: 17.5, run: 0, maxRun: 900 }, own);
    expect(short.level).toBe('clear');
    expect(short.eta).toBeNull();
  });
});

describe('ship handling', () => {
  it('sheds sternway toward STOP as slowly as it sheds headway', () => {
    const ratio = (telegraph: number): number => {
      const ship = new ShipDynamics(battleshipHandling(160.6, 21));
      ship.setTelegraph(telegraph);
      for (let t = 0; t < 500; t += 1 / 60) ship.step(1 / 60);
      const before = ship.speed;
      ship.setTelegraph(TELEGRAPH.STOP);
      for (let t = 0; t < 60; t += 1 / 60) ship.step(1 / 60);
      return ship.speed / before;
    };
    const ahead = ratio(TELEGRAPH.HALF_AHEAD);
    const astern = ratio(TELEGRAPH.HALF_ASTERN);
    expect(ahead).toBeGreaterThan(0.4);
    expect(Math.abs(ahead - astern)).toBeLessThan(0.02);
  });
});

describe('a dead calm', () => {
  it('gives a finite spectrum, not NaN', () => {
    const p: SpectrumParams = { windSpeed: 0, waveDirRad: 0, fetchM: 100_000, gamma: 3.3 };
    expect(Number.isFinite(peakOmega(p))).toBe(true);
    for (const w of [0.3, 1, 3]) {
      const s = jonswapOmega(w, p);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('input edge cases', () => {
  function fakeTarget() {
    const listeners = new Map<string, ((e: unknown) => void)[]>();
    return {
      addEventListener(type: string, fn: (e: unknown) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      fire(type: string, event: Record<string, unknown> = {}) {
        for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, ...event });
      },
    };
  }

  it('an idle gamepad does not become the active device because the keyboard wrote a target or correction edge', () => {
    const pad: GamepadLike = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    const src = new GamepadSource(() => [pad], () => 0);
    const out = createIntent();
    src.poll(out);
    out.cycleTarget = 1;
    out.rangeCorrect = 2;
    out.deflectCorrect = -1;
    expect(src.poll(out)).toBe(false);
  });

  it('a cancelled right-button pointer lets go of the sight', () => {
    const t = fakeTarget();
    const src = new PointerCameraSource('keyboard-mouse', 'mouse', t);
    const out = createIntent();
    t.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 10, clientY: 10 });
    src.poll(out);
    expect(out.sight).toBe(true);
    // Per the Pointer Events spec a pointercancel carries button -1.
    t.fire('pointercancel', { pointerId: 1, pointerType: 'mouse', button: -1 });
    resetLevels(out);
    src.poll(out);
    expect(out.sight).toBe(false);
  });
});

describe('frame-time hygiene', () => {
  it('one long hitch (the tab in the background) does not cut the resolution', () => {
    const c = new RenderScaleController(0.5, 1, 1, 15);
    for (let i = 0; i < 60; i++) c.sample(16.7, 0.0167);
    c.sample(5000, 0.1);
    for (let i = 0; i < 120; i++) c.sample(16.7, 0.0167);
    expect(c.scale).toBe(1);
    expect(c.changes).toBe(0);
  });

  it('a NaN frame does not stop the simulation for good', () => {
    const s = new FixedStepper(1 / 60);
    expect(s.advance(Number.NaN)).toBe(0);
    expect(s.advance(1 / 60)).toBe(1);
  });
});
