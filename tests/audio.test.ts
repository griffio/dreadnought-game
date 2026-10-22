import { describe, expect, it } from 'vitest';
import { AudioDirector, type AudioOut, type LoopHandle, type PlayOptions, type SoundState } from '../src/audio/director';
import { loadSettings } from '../src/audio/engine';
import { attenuation, lowpassFor, panFor, slowPitch, soundDelay, SPEED_OF_SOUND, type Listener } from '../src/audio/spatial';
import { tapEffects } from '../src/audio/tap';
import { RECORDED_EFFECTS } from '../src/app/replay';

const at = (x: number, z: number, yawDeg = 0): Listener => ({ x, z, yawDeg });

describe('spatial', () => {
  it('delays a sound by the time it takes to cross the distance, and scales it', () => {
    expect(soundDelay(3430)).toBeCloseTo(3430 / SPEED_OF_SOUND, 6);
    expect(soundDelay(3430, 0.5)).toBeCloseTo(5, 6);
    expect(soundDelay(0)).toBe(0);
    expect(soundDelay(-5)).toBe(0);
  });

  it('caps the wait for a very distant sound', () => {
    expect(soundDelay(1e7)).toBe(60);
  });

  it('halves the loudness at the sound’s own reach and keeps nearer sounds louder', () => {
    expect(attenuation(0, 1000)).toBe(1);
    expect(attenuation(1000, 1000)).toBeCloseTo(0.5, 6);
    expect(attenuation(500, 1000)).toBeGreaterThan(attenuation(2000, 1000));
  });

  it('pans a sound to the side it is on, as seen from where she is looking', () => {
    // Looking north (yaw 0, -z): east (+x) is on the right.
    expect(panFor(at(0, 0, 0), 500, 0)).toBeGreaterThan(0.8);
    expect(panFor(at(0, 0, 0), -500, 0)).toBeLessThan(-0.8);
    expect(Math.abs(panFor(at(0, 0, 0), 0, -500))).toBeLessThan(1e-9);
    // Looking east (yaw 90): north is now on the left, south on the right.
    expect(panFor(at(0, 0, 90), 0, -500)).toBeLessThan(-0.8);
    expect(panFor(at(0, 0, 90), 0, 500)).toBeGreaterThan(0.8);
    // A sound on top of her is not hard to one side.
    expect(Math.abs(panFor(at(0, 0, 0), 2, 0))).toBeLessThan(0.1);
    expect(panFor(at(0, 0, 0), 0, 0)).toBe(0);
  });

  it('takes the high notes out of a distant sound', () => {
    expect(lowpassFor(0)).toBeGreaterThan(15000);
    expect(lowpassFor(10000)).toBeLessThan(1500);
    expect(lowpassFor(2000)).toBeGreaterThan(lowpassFor(6000));
  });

  it('drops the pitch in slow motion and not otherwise', () => {
    expect(slowPitch(1)).toBe(1);
    expect(slowPitch(3)).toBe(1);
    expect(slowPitch(0.3)).toBeLessThan(0.7);
    expect(slowPitch(0)).toBeCloseTo(0.55, 6);
  });
});

interface Played {
  id: string;
  o: PlayOptions;
}

class FakeOut implements AudioOut {
  played: Played[] = [];
  loops = new Map<string, { opts: PlayOptions; last: { gain?: number; rate?: number }; stopped: boolean }>();
  ducks: number[] = [];
  play(id: string, o: PlayOptions = {}): void {
    this.played.push({ id, o });
  }
  loop(id: string, o: PlayOptions = {}): LoopHandle {
    const rec = { opts: o, last: { gain: o.gain, rate: o.rate }, stopped: false };
    this.loops.set(id, rec);
    return {
      set: (v) => Object.assign(rec.last, v),
      stop: () => (rec.stopped = true),
    };
  }
  duck(amount: number): void {
    this.ducks.push(amount);
  }
  /** Sounds that are not ready yet (the page has not been touched, or they are not decoded). */
  notReady = new Set<string>();
  ready(id: string): boolean {
    return !this.notReady.has(id);
  }
  family(prefix: string): Played[] {
    return this.played.filter((p) => p.id.startsWith(prefix));
  }
}

const IDS = [
  'gun-heavy-1', 'gun-heavy-2', 'gun-heavy-3', 'gun-medium-1', 'gun-light-1', 'gun-distant-1', 'splash-big-1', 'splash-big-2', 'splash-small-1',
  'hit-burst-1', 'hit-clang-1', 'hit-ricochet-1', 'explosion-magazine', 'sea-loop', 'engine-loop', 'prop-loop', 'fire-loop', 'turret-motor', 'plane-loop',
  'telegraph-bell', 'klaxon', 'sinking', 'flood', 'creak-1', 'creak-2', 'shell-whistle-1', 'torpedo-launch',
];

function state(patch: Partial<SoundState> = {}): SoundState {
  return {
    listener: at(0, 0, 0),
    timeScale: 1,
    paused: false,
    speedFrac: 0.5,
    power: 0.5,
    telegraph: 1,
    wind: 10,
    fireDistance: Infinity,
    fires: 0,
    turretMotion: 0,
    flooding: false,
    damage: 0,
    turning: false,
    incoming: [],
    threats: 0,
    sunk: 0,
    sunkDistance: Infinity,
    planeDistance: null,
    ...patch,
  };
}

function setup(patch: Partial<SoundState> = {}) {
  const out = new FakeOut();
  const d = new AudioDirector(out, IDS, () => 0.5);
  d.update(0.016, state(patch));
  return { out, d };
}

type V3 = [number, number, number];
const blast = (d: AudioDirector, x: number, z: number, caliber: number): void => d.onEffect('muzzleBlast', [[x, 20, z] as V3, [0, 0, -1] as V3, caliber]);

describe('director: spectacles', () => {
  it('sounds a heavy gun as a heavy gun, late by the distance', () => {
    const { out, d } = setup();
    blast(d, 0, -1000, 0.381);
    const p = out.family('gun-heavy');
    expect(p).toHaveLength(1);
    expect(p[0]!.o.delay).toBeCloseTo(1000 / SPEED_OF_SOUND, 2);
    expect(p[0]!.o.gain).toBeGreaterThan(0.3);
  });

  it('makes a distant gun a distant thud and muffles it', () => {
    const { out, d } = setup();
    blast(d, 0, -9000, 0.381);
    expect(out.family('gun-heavy')).toHaveLength(0);
    const p = out.family('gun-distant');
    expect(p).toHaveLength(1);
    expect(p[0]!.o.lowpass).toBeLessThan(2000);
    expect(p[0]!.o.delay).toBeGreaterThan(20);
  });

  it('chooses a lighter sound for a lighter gun', () => {
    const { out, d } = setup();
    blast(d, 0, -800, 0.152);
    blast(d, 0, -800, 0.1);
    expect(out.family('gun-medium')).toHaveLength(1);
    expect(out.family('gun-light')).toHaveLength(1);
  });

  it('does not sound every gun of a broadside', () => {
    const { out, d } = setup();
    for (let i = 0; i < 10; i++) blast(d, 0, -600, 0.381);
    expect(out.family('gun-heavy').length).toBeLessThanOrEqual(3);
    expect(out.family('gun-heavy').length).toBeGreaterThan(0);
    // After the window, the next salvo is heard again.
    for (let i = 0; i < 40; i++) d.update(0.05, state());
    blast(d, 0, -600, 0.381);
    expect(out.family('gun-heavy').length).toBeGreaterThan(3 - 1);
  });

  it('ducks the ambience under a heavy gun close by, and not under a far one', () => {
    const near = setup();
    blast(near.d, 0, -300, 0.381);
    expect(near.out.ducks.length).toBe(1);
    const far = setup();
    blast(far.d, 0, -4000, 0.381);
    expect(far.out.ducks.length).toBe(0);
  });

  it('ignores a sound too faint to hear', () => {
    const { out, d } = setup();
    d.onEffect('shellSplash', [0, -60000, 0.381]);
    expect(out.played).toHaveLength(0);
  });

  it('tells a big splash from a small one, and a glance from a clang', () => {
    const { out, d } = setup();
    d.onEffect('shellSplash', [100, -300, 0.381]);
    d.onEffect('shellSplash', [100, -300, 0.1]);
    expect(out.family('splash-big')).toHaveLength(1);
    expect(out.family('splash-small')).toHaveLength(1);
    d.onEffect('armorSpark', [0, 5, -300, 0.381, true]);
    d.onEffect('armorSpark', [0, 5, -300, 0.381, false]);
    expect(out.family('hit-ricochet')).toHaveLength(1);
    expect(out.family('hit-clang')).toHaveLength(1);
  });

  it('sounds a burst, a magazine and a torpedo leaving', () => {
    const { out, d } = setup();
    d.onEffect('hitBurst', [0, 5, -400, 0.381, 'ap']);
    d.onEffect('explosion', [0, 10, -500, 1]);
    d.onEffect('torpedoLaunch', [10, -10]);
    expect(out.family('hit-burst')).toHaveLength(1);
    expect(out.family('explosion-magazine')).toHaveLength(1);
    expect(out.family('torpedo-launch')).toHaveLength(1);
  });

  it('waits longer in slow motion, and drops the pitch', () => {
    const slow = setup({ timeScale: 0.25 });
    blast(slow.d, 0, -1000, 0.381);
    const normal = setup({ timeScale: 1 });
    blast(normal.d, 0, -1000, 0.381);
    const a = slow.out.family('gun-heavy')[0]!.o;
    const b = normal.out.family('gun-heavy')[0]!.o;
    expect(a.delay!).toBeGreaterThan(b.delay! * 3);
    expect(a.rate!).toBeLessThan(b.rate! * 0.8);
  });

  it('is silent while paused', () => {
    const { out, d } = setup({ paused: true });
    blast(d, 0, -500, 0.381);
    expect(out.played).toHaveLength(0);
  });

  it('is silent for effects with no sound, and before it has heard the game', () => {
    const out = new FakeOut();
    const d = new AudioDirector(out, IDS);
    blast(d, 0, -500, 0.381);
    expect(out.played).toHaveLength(0);
    d.update(0.016, state());
    d.onEffect('funnelPuff', []);
    d.onEffect('tracer', [0, 0, 0, 'ap']);
    expect(out.played).toHaveLength(0);
  });

  it('does not fail for a sound that is not in the set', () => {
    const out = new FakeOut();
    const d = new AudioDirector(out, ['sea-loop']);
    d.update(0.016, state());
    expect(() => blast(d, 0, -500, 0.381)).not.toThrow();
    expect(out.played).toHaveLength(0);
  });
});

describe('director: the beds', () => {
  it('starts the sea and the engines and follows the ship’s speed', () => {
    const { out, d } = setup({ speedFrac: 0.1, power: 0.1 });
    expect(out.loops.has('sea-loop')).toBe(true);
    expect(out.loops.has('engine-loop')).toBe(true);
    const slowRate = out.loops.get('engine-loop')!.last.rate!;
    const slowGain = out.loops.get('engine-loop')!.last.gain!;
    d.update(0.016, state({ speedFrac: 1, power: 1 }));
    expect(out.loops.get('engine-loop')!.last.rate!).toBeGreaterThan(slowRate);
    expect(out.loops.get('engine-loop')!.last.gain!).toBeGreaterThan(slowGain);
  });

  it('brings the screw in with speed only', () => {
    const { out, d } = setup({ speedFrac: 0, power: 0 });
    expect(out.loops.has('prop-loop')).toBe(false);
    d.update(0.016, state({ speedFrac: 0.9, power: 0.9 }));
    expect(out.loops.get('prop-loop')!.last.gain!).toBeGreaterThan(0.2);
  });

  it('crackles with a fire near, and less with one far off', () => {
    const near = setup({ fires: 1, fireDistance: 100 });
    const far = setup({ fires: 1, fireDistance: 5000 });
    expect(near.out.loops.get('fire-loop')!.last.gain!).toBeGreaterThan(far.out.loops.get('fire-loop')!.last.gain! * 3);
    const none = setup({ fires: 0 });
    expect(none.out.loops.has('fire-loop')).toBe(false);
  });

  it('runs the turret motors while the turrets train, and the aircraft’s engine while it flies', () => {
    const { out, d } = setup({ turretMotion: 1, planeDistance: 300 });
    expect(out.loops.get('turret-motor')!.last.gain!).toBeGreaterThan(0.1);
    expect(out.loops.get('plane-loop')!.last.gain!).toBeGreaterThan(0.1);
    d.update(0.016, state({ turretMotion: 0, planeDistance: null }));
    expect(out.loops.get('turret-motor')!.last.gain!).toBe(0);
    expect(out.loops.get('plane-loop')!.last.gain!).toBe(0);
  });

  it('rings the bell for a new order but not for the first reading', () => {
    const { out, d } = setup({ telegraph: 2 });
    expect(out.family('telegraph-bell')).toHaveLength(0);
    d.update(0.016, state({ telegraph: 3 }));
    expect(out.family('telegraph-bell')).toHaveLength(1);
    d.update(0.016, state({ telegraph: 3 }));
    expect(out.family('telegraph-bell')).toHaveLength(1);
  });

  it('sounds the alarm for a new torpedo wake, once', () => {
    const { out, d } = setup({ threats: 0 });
    d.update(0.016, state({ threats: 1 }));
    expect(out.family('klaxon')).toHaveLength(1);
    d.update(0.016, state({ threats: 1 }));
    expect(out.family('klaxon')).toHaveLength(1);
  });

  it('sounds a ship going down, and the player’s water coming aboard, once each', () => {
    const { out, d } = setup();
    d.update(0.016, state({ sunk: 1, sunkDistance: 800 }));
    d.update(0.016, state({ sunk: 1, sunkDistance: 800 }));
    expect(out.family('sinking')).toHaveLength(1);
    d.update(0.016, state({ flooding: true }));
    d.update(0.016, state({ flooding: true }));
    expect(out.family('flood')).toHaveLength(1);
  });

  it('whistles for a shell coming down near, once per shell', () => {
    const { out, d } = setup();
    const shell = { id: 'a', distance: 200, falling: true };
    d.update(0.016, state({ incoming: [shell] }));
    d.update(0.016, state({ incoming: [shell] }));
    expect(out.family('shell-whistle')).toHaveLength(1);
    d.update(0.016, state({ incoming: [{ id: 'b', distance: 150, falling: false }] }));
    expect(out.family('shell-whistle')).toHaveLength(1);
    d.update(0.016, state({ incoming: [{ id: 'c', distance: 5000, falling: true }] }));
    expect(out.family('shell-whistle')).toHaveLength(1);
  });

  it('lets the hull creak now and then when she is hurt', () => {
    const { out, d } = setup({ damage: 0.5 });
    for (let i = 0; i < 4000; i++) d.update(0.05, state({ damage: 0.5 }));
    expect(out.family('creak').length).toBeGreaterThan(2);
    const calm = setup({ damage: 0 });
    for (let i = 0; i < 4000; i++) calm.d.update(0.05, state({ damage: 0, turning: false }));
    expect(calm.out.family('creak')).toHaveLength(0);
  });

  it('waits to start a bed until its sound can be played, and then starts it', () => {
    const out = new FakeOut();
    out.notReady = new Set(['sea-loop', 'engine-loop', 'prop-loop']);
    const d = new AudioDirector(out, IDS, () => 0.5);
    d.update(0.016, state({ speedFrac: 0.8, power: 0.8 }));
    expect(out.loops.size).toBe(0);
    out.notReady.clear();
    d.update(0.016, state({ speedFrac: 0.8, power: 0.8 }));
    expect(out.loops.has('sea-loop')).toBe(true);
    expect(out.loops.has('engine-loop')).toBe(true);
  });

  it('can be put down', () => {
    const { out, d } = setup();
    d.silence();
    expect(out.loops.get('sea-loop')!.stopped).toBe(true);
  });
});

describe('tap', () => {
  it('tells the listener of each spectacle call and still carries it out, with the call’s own result', () => {
    const calls: string[] = [];
    const heard: string[] = [];
    const fx = {} as Record<(typeof RECORDED_EFFECTS)[number], (...a: never[]) => unknown>;
    for (const name of RECORDED_EFFECTS) fx[name] = ((...a: unknown[]) => (calls.push(`${name}:${a.join(',')}`), name)) as never;
    tapEffects(fx, (name, args) => heard.push(`${name}:${args.join(',')}`));
    expect((fx.shellSplash as (...a: unknown[]) => unknown)(1, 2, 0.3)).toBe('shellSplash');
    expect(calls).toEqual(['shellSplash:1,2,0.3']);
    expect(heard).toEqual(['shellSplash:1,2,0.3']);
  });

  it('never lets a failure to sound a call stop it being drawn', () => {
    const calls: string[] = [];
    const fx = {} as Record<(typeof RECORDED_EFFECTS)[number], (...a: never[]) => unknown>;
    for (const name of RECORDED_EFFECTS) fx[name] = ((...a: unknown[]) => void calls.push(name)) as never;
    tapEffects(fx, () => {
      throw new Error('no audio');
    });
    expect(() => (fx.explosion as (...a: unknown[]) => unknown)(0, 0, 0)).not.toThrow();
    expect(calls).toEqual(['explosion']);
  });

  it('is in step with what the replay records, so that a replay is heard', () => {
    expect(RECORDED_EFFECTS).toContain('muzzleBlast');
    expect(RECORDED_EFFECTS).toContain('torpedoLaunch');
  });
});

describe('settings', () => {
  const store = (v: string | null) => ({ getItem: () => v });

  it('starts with sound on at a sensible level', () => {
    expect(loadSettings(store(null))).toEqual({ muted: false, volume: 0.8, voices: true });
    expect(loadSettings(null)).toEqual({ muted: false, volume: 0.8, voices: true });
  });

  it('remembers what was chosen', () => {
    expect(loadSettings(store(JSON.stringify({ muted: true, volume: 0.3 })))).toEqual({ muted: true, volume: 0.3, voices: true });
  });

  it('remembers that the voices were turned off, and that only the voices were', () => {
    const s = loadSettings(store(JSON.stringify({ muted: false, volume: 0.5, voices: false })));
    expect(s.voices).toBe(false);
    expect(s.muted).toBe(false);
  });

  it('survives rubbish and keeps the volume in range', () => {
    expect(loadSettings(store('not json'))).toEqual({ muted: false, volume: 0.8, voices: true });
    expect(loadSettings(store(JSON.stringify({ volume: 9 }))).volume).toBe(1);
    expect(loadSettings(store(JSON.stringify({ volume: -2 }))).volume).toBe(0);
    expect(loadSettings({ getItem: () => { throw new Error('blocked'); } })).toEqual({ muted: false, volume: 0.8, voices: true });
  });
});
