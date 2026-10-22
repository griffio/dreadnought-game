import { describe, expect, it } from 'vitest';
import { RECORDED_EFFECTS, ReplayPlayer, ReplayRecorder, viewAt, type EffectName, type ReplaySample, type ReplayTarget, type ShipShot } from '../src/app/replay';

const ship = (x: number, over: Partial<ShipShot> = {}): ShipShot => ({ x, z: 0, headingDeg: 0, heave: 0, pitch: 0, roll: 0, speed: 10, power: 0.8, visible: true, guns: new Float32Array([0.1, 0.2, 0]), ...over });

function sample(t: number, over: Partial<ReplaySample> = {}): ReplaySample {
  return { t, sea: t * 2, ships: [ship(t * 10), ship(1000 - t * 10)], shells: [], ...over };
}

/** A stand-in for the spectacle: every method records that it was called. */
function fakeEffects(): { fx: Record<EffectName, (...a: unknown[]) => void>; calls: string[] } {
  const calls: string[] = [];
  const fx = {} as Record<EffectName, (...a: unknown[]) => void>;
  for (const name of RECORDED_EFFECTS) fx[name] = (...args: unknown[]) => void calls.push(`${name}(${args.join(',')})`);
  return { fx, calls };
}

class Fake implements ReplayTarget {
  fired: { name: EffectName; args: readonly unknown[] }[] = [];
  wake: { i: number; t: number }[] = [];
  applied: { i: number; x: number }[] = [];
  resets = 0;
  wakeClears = 0;
  advanced = 0;
  clocks: { sea: number; sim: number } = { sea: 0, sim: 0 };
  applyShip(i: number, s: ShipShot): void {
    this.applied.push({ i, x: s.x });
  }
  recordWake(i: number, t: number): void {
    this.wake.push({ i, t });
  }
  clearWake(): void {
    this.wakeClears++;
    this.wake = [];
  }
  fire(name: EffectName, args: readonly unknown[]): void {
    this.fired.push({ name, args });
  }
  resetFx(): void {
    this.resets++;
    this.fired = [];
  }
  advanceFx(dt: number): void {
    this.advanced += dt;
  }
  setClocks(sea: number, sim: number): void {
    this.clocks = { sea, sim };
  }
}

/** Ten seconds of fight at 60 samples a second, with a tracer call every sample and a splash at 4 s and at 8 s. */
function recorded(window = 90): { rec: ReplayRecorder; now: () => number; calls: string[] } {
  const rec = new ReplayRecorder(window);
  const { fx, calls } = fakeEffects();
  let t = 0;
  rec.install(fx as never, () => t);
  for (let i = 0; i <= 600; i++) {
    t = i / 60;
    fx.tracer(t, 0, 0);
    if (i === 240 || i === 480) fx.shellSplash(t * 100, 0, 0.3);
    rec.sample(sample(t));
  }
  return { rec, now: () => t, calls };
}

describe('the recorder', () => {
  it('records each call to a spectacle with the time it was made, and carries it out as before', () => {
    const { rec, calls } = recorded();
    expect(calls.length).toBe(601 + 2);
    expect(rec.eventCount).toBe(601 + 2);
    const splash = rec.eventAt(rec.eventAfter(3.99) + 1);
    expect(splash.name === 'shellSplash' || splash.name === 'tracer').toBe(true);
    expect(rec.eventAt(0).name).toBe('tracer');
    expect(rec.eventAt(0).t).toBe(0);
  });

  it('keeps thirty samples a second, however often it is offered one', () => {
    const { rec } = recorded();
    expect(rec.sampleCount).toBe(301);
    expect(rec.range).toEqual({ start: 0, end: 10 });
  });

  it('lets go of what is older than its window, keeping the calls a little longer to rebuild smoke from', () => {
    const rec = new ReplayRecorder(5, 30, 3);
    const { fx } = fakeEffects();
    let t = 0;
    rec.install(fx as never, () => t);
    for (let i = 0; i <= 20 * 60; i++) {
      t = i / 60;
      fx.tracer(t, 0, 0);
      rec.sample(sample(t));
    }
    expect(rec.range!.start).toBeCloseTo(15, 1);
    expect(rec.range!.end).toBeCloseTo(20, 5);
    // The calls reach three seconds further back than the samples do.
    expect(rec.eventAt(0).t).toBeCloseTo(12, 1);
    expect(rec.sampleCount).toBeLessThan(160);
  });

  it('does not record the calls a replay itself makes', () => {
    const rec = new ReplayRecorder();
    const { fx } = fakeEffects();
    rec.install(fx as never, () => 1);
    rec.suspended = true;
    fx.tracer(1, 2, 3);
    rec.suspended = false;
    fx.tracer(1, 2, 3);
    expect(rec.eventCount).toBe(1);
  });
});

describe('the picture at a moment', () => {
  it('is the ships and shells interpolated between the samples either side', () => {
    const rec = new ReplayRecorder();
    rec.sample({ t: 0, sea: 0, ships: [ship(0, { headingDeg: 350, roll: 0.1 })], shells: [{ id: 1, x: 0, y: 100, z: 0, vx: 100, vy: 0, vz: 0 }] });
    rec.sample({ t: 1, sea: 4, ships: [ship(100, { headingDeg: 10, roll: -0.1 })], shells: [{ id: 1, x: 100, y: 50, z: 0, vx: 100, vy: -50, vz: 0 }, { id: 2, x: 5, y: 5, z: 5, vx: 0, vy: 0, vz: 0 }] });
    const v = viewAt(rec, 0.25)!;
    expect(v.ships[0]!.x).toBeCloseTo(25, 6);
    expect(v.ships[0]!.roll).toBeCloseTo(0.05, 6);
    expect(v.sea).toBeCloseTo(1, 6);
    expect(v.shells.map((s) => s.id)).toEqual([1]);
    expect(v.shells[0]!.y).toBeCloseTo(87.5, 6);
    // Halfway, the heading goes the short way round through north, not the long way through south.
    expect(viewAt(rec, 0.5)!.ships[0]!.headingDeg).toBeCloseTo(0, 6);
    // A shell that has just left the guns is there once the moment is nearer the later sample.
    expect(viewAt(rec, 0.75)!.shells.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it('is the first or last sample outside the recording, and nothing when nothing was recorded', () => {
    const rec = new ReplayRecorder();
    expect(viewAt(rec, 3)).toBeNull();
    rec.sample(sample(1));
    rec.sample(sample(2));
    expect(viewAt(rec, -5)!.ships[0]!.x).toBe(10);
    expect(viewAt(rec, 99)!.ships[0]!.x).toBe(20);
  });
});

describe('playback', () => {
  it('makes each recorded call once, in order, as the clock passes it', () => {
    const { rec } = recorded();
    const target = new Fake();
    const p = new ReplayPlayer(rec, target);
    expect(p.t).toBe(0);
    for (let i = 0; i < 60 * 5; i++) p.advance(1 / 60);
    const splashes = target.fired.filter((f) => f.name === 'shellSplash');
    expect(splashes.length).toBe(1);
    expect(p.t).toBeCloseTo(5, 6);
    // Every tracer call up to the moment (give or take the one on the edge of the floating-point clock), none repeated.
    const tracers = target.fired.filter((f) => f.name === 'tracer');
    expect(tracers.length).toBeGreaterThanOrEqual(299);
    expect(tracers.length).toBeLessThanOrEqual(301);
    expect(new Set(tracers.map((f) => f.args[0])).size).toBe(tracers.length);
    for (let i = 0; i < 60 * 5; i++) p.advance(1 / 60);
    expect(target.fired.filter((f) => f.name === 'shellSplash').length).toBe(2);
    expect(p.playing).toBe(false);
    expect(p.t).toBe(10);
  });

  it('runs at the speed asked for, and not at all when paused', () => {
    const { rec } = recorded();
    const target = new Fake();
    const p = new ReplayPlayer(rec, target);
    p.speed = 0.25;
    for (let i = 0; i < 60; i++) p.advance(1 / 60);
    expect(p.t).toBeCloseTo(0.25, 6);
    p.playing = false;
    const fired = target.fired.length;
    for (let i = 0; i < 60; i++) p.advance(1 / 60);
    expect(p.t).toBeCloseTo(0.25, 6);
    expect(target.fired.length).toBe(fired);
  });

  it('lays the ships as they were and sets the clocks to the recorded ones', () => {
    const { rec } = recorded();
    const target = new Fake();
    const p = new ReplayPlayer(rec, target);
    for (let i = 0; i < 60; i++) p.advance(1 / 60);
    expect(target.clocks.sim).toBeCloseTo(1, 6);
    expect(target.clocks.sea).toBeCloseTo(2, 4);
    const last = target.applied.filter((a) => a.i === 0).pop()!;
    expect(last.x).toBeCloseTo(10, 4);
    const other = target.applied.filter((a) => a.i === 1).pop()!;
    expect(other.x).toBeCloseTo(990, 4);
  });

  it('can go to any moment: the air and the water are rebuilt from what was called in the time before it', () => {
    const { rec } = recorded();
    const target = new Fake();
    const p = new ReplayPlayer(rec, target, 3);
    p.seek(8.5);
    expect(target.resets).toBe(1);
    expect(target.wakeClears).toBe(1);
    expect(p.t).toBe(8.5);
    // Three seconds are rebuilt, in steps: the splash at 8 s is among them, and the one at 4 s is not.
    expect(target.advanced).toBeCloseTo(3, 4);
    expect(target.fired.filter((f) => f.name === 'shellSplash').length).toBe(1);
    expect(target.fired.some((f) => f.name === 'shellSplash' && Math.abs(Number(f.args[0]) - 800) < 1)).toBe(true);
    // The wake is laid for the samples in that time, both ships.
    expect(target.wake.filter((w) => w.i === 0).length).toBeGreaterThan(80);
    expect(target.wake.every((w) => w.t > 5.5 && w.t <= 8.5)).toBe(true);
    // And it plays on from there.
    p.advance(0.5);
    expect(p.t).toBeCloseTo(9, 6);
  });

  it('can go back and play the same moment again', () => {
    const { rec } = recorded();
    const target = new Fake();
    const p = new ReplayPlayer(rec, target, 2);
    for (let i = 0; i < 60 * 9; i++) p.advance(1 / 60);
    p.seek(3);
    expect(p.t).toBe(3);
    p.playing = true;
    for (let i = 0; i < 60 * 2; i++) p.advance(1 / 60);
    // The splash at 4 s is made again, once, since going back threw the old ones away.
    expect(target.fired.filter((f) => f.name === 'shellSplash').length).toBe(1);
  });

  it('keeps its seek inside the recording', () => {
    const { rec } = recorded();
    const p = new ReplayPlayer(rec, new Fake());
    p.seek(-4);
    expect(p.t).toBe(0);
    p.seek(400);
    expect(p.t).toBe(10);
  });
});
