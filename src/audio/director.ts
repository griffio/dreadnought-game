import type { EffectName } from '../app/replay';
import { attenuation, distanceTo, lowpassFor, panFor, slowPitch, soundDelay, type Listener } from './spatial';

export type Bus = 'sfx' | 'ambience' | 'voice';

export interface PlayOptions {
  /** 0..1.5 */
  gain?: number;
  /** Playback rate: 1 is as recorded. */
  rate?: number;
  /** Seconds from now (real time). */
  delay?: number;
  pan?: number;
  /** Cut-off of a low-pass filter, Hz (omit for none). */
  lowpass?: number;
  bus?: Bus;
}

export interface LoopHandle {
  set(o: { gain?: number; rate?: number; lowpass?: number; pan?: number }): void;
  stop(): void;
}

/** Where the director's decisions go: the audio engine in the game, a recorder in the tests. */
export interface AudioOut {
  play(id: string, o?: PlayOptions): void;
  loop(id: string, o?: PlayOptions): LoopHandle;
  /** Pull the ambience down by a fraction for a moment: a heavy gun has fired. */
  duck(amount: number, seconds: number): void;
  /** Whether a sound can be played now (the page has been touched and it is decoded). Without it every sound is taken to be ready. */
  ready?(id: string): boolean;
}

/** What the director reads off the game each frame, in the game's own terms. */
export interface SoundState {
  listener: Listener;
  /** Game seconds per real second (1 normally; less in the shell camera's slow motion; 0 when stopped). */
  timeScale: number;
  paused: boolean;
  /** The player's ship: speed as a fraction of her best, engine power 0..1, and the telegraph she is ordered to. */
  speedFrac: number;
  power: number;
  telegraph: number;
  /** Wind, m/s. */
  wind: number;
  /** Nearest burning ship, metres (Infinity if none) and how many are burning. */
  fireDistance: number;
  fires: number;
  /** Fraction of her main turrets that are training (0 when all are laid). */
  turretMotion: number;
  /** She is taking on water. */
  flooding: boolean;
  /** How much damage the player's ship has taken, 0..1. */
  damage: number;
  /** She is turning hard. */
  turning: boolean;
  /** Enemy shells in the air: how far from the listener, and whether they are coming down. */
  incoming: { id: string; distance: number; falling: boolean }[];
  /** Torpedo wakes the bridge has seen running at her. */
  threats: number;
  /** Ships that have gone down so far, and how far from the listener the last one was. */
  sunk: number;
  sunkDistance: number;
  /** The spotter aircraft: how far, or null when it is not flying. */
  planeDistance: number | null;
}

/** Each effect's own reach in metres (how far its sound carries), loudness, and when it is cut back. */
const REACH = { gun: 3200, splash: 900, hit: 1800, boom: 9000 } as const;

const SPEED_FAMILIES = ['sea-loop', 'engine-loop', 'prop-loop'] as const;

type V3 = readonly [number, number, number];

/**
 * The sound designer: turns what the game draws (each muzzle blast, splash, burst) and what its state says (the engines, the fires, the
 * incoming shells) into the sounds to play, where from and how loud. It works from `Effects` calls so that a replay, which makes
 * the same calls, is heard as well as seen. A sound is delayed by its distance at the speed of sound; the far guns are muffled and
 * thinned out; and a salvo's ten guns are not ten sounds.
 */
export class AudioDirector {
  /** Sound ids by family ('gun-heavy' -> gun-heavy-1, gun-heavy-2...). */
  private readonly families = new Map<string, string[]>();
  private readonly loops = new Map<string, LoopHandle>();
  private readonly recent = new Map<string, number[]>();
  private readonly whistled = new Set<string>();
  private clock = 0;
  private state: SoundState | null = null;
  private lastTelegraph: number | null = null;
  private lastThreats = 0;
  private lastSunk = 0;
  private wasFlooding = false;
  private nextCreak = 25;
  /** Scales every sound's delay: 1 is the true speed of sound. */
  delayScale = 1;
  /** What the player has chosen: the mix goes to the engine's master gain, but the director knows when it is off. */
  enabled = true;

  constructor(
    private readonly out: AudioOut,
    ids: readonly string[],
    private readonly random: () => number = Math.random,
  ) {
    for (const id of ids) {
      const family = id.replace(/-\d+$/, '');
      const list = this.families.get(family) ?? [];
      list.push(id);
      this.families.set(family, list);
    }
  }

  has(family: string): boolean {
    return this.families.has(family);
  }

  private pick(family: string): string | null {
    const list = this.families.get(family);
    if (!list || list.length === 0) return null;
    return list[Math.floor(this.random() * list.length) % list.length]!;
  }

  /** At most `max` sounds of `key` in any `window` real seconds. */
  private allow(key: string, max: number, window: number): boolean {
    const times = (this.recent.get(key) ?? []).filter((t) => this.clock - t < window);
    if (times.length >= max) {
      this.recent.set(key, times);
      return false;
    }
    times.push(this.clock);
    this.recent.set(key, times);
    return true;
  }

  private get timeScale(): number {
    return Math.max(this.state?.timeScale ?? 1, 0.05);
  }

  /** Play a family's sound where it happened. `reach` is how far it carries; `gain` its loudness at the source. */
  private at(family: string, x: number, z: number, reach: number, gain: number, rate = 1): void {
    const s = this.state;
    if (!this.enabled || !s || s.paused) return;
    const id = this.pick(family);
    if (!id) return;
    const r = distanceTo(s.listener, x, z);
    const g = gain * attenuation(r, reach);
    if (g < 0.015) return;
    // The delay is game time: in slow motion the sound is as slow as the shell.
    const delay = Math.min(soundDelay(r, this.delayScale) / this.timeScale, 60);
    this.out.play(id, { gain: g, rate: rate * (0.96 + 0.08 * this.random()) * slowPitch(s.timeScale), delay, pan: panFor(s.listener, x, z), lowpass: r > 400 ? lowpassFor(r) : undefined });
  }

  /** The game drew a spectacle: if it has a sound, make it. */
  onEffect(name: EffectName, args: readonly unknown[]): void {
    const s = this.state;
    if (!s) return;
    switch (name) {
      case 'muzzleBlast': {
        const [muzzle, , caliber] = args as [V3, V3, number];
        const r = distanceTo(s.listener, muzzle[0], muzzle[2]);
        const heavy = caliber >= 0.2;
        const family = heavy ? (r > 5500 ? 'gun-distant' : 'gun-heavy') : caliber >= 0.12 ? 'gun-medium' : 'gun-light';
        // A broadside is a dozen blasts within a second: the first few are heard, and the rest are the same sound.
        if (!this.allow(family, heavy ? 3 : 4, heavy ? 0.5 : 0.3)) return;
        const rate = heavy ? 1.05 - Math.min(Math.max(caliber - 0.3, 0), 0.15) : 1;
        this.at(family, muzzle[0], muzzle[2], family === 'gun-distant' ? REACH.boom : REACH.gun, heavy ? 1 : caliber >= 0.12 ? 0.7 : 0.45, rate);
        if (heavy && r < 1200) this.out.duck(0.45, 1.6);
        break;
      }
      case 'shellSplash': {
        const [x, z, caliber] = args as [number, number, number];
        // A torpedo leaving the tube makes a small splash of its own, and is not a shell falling.
        const big = caliber >= 0.2;
        if (!this.allow('splash', 4, 0.5)) return;
        this.at(big ? 'splash-big' : 'splash-small', x, z, REACH.splash, big ? 0.95 : 0.5, big ? 1.05 - caliber * 0.2 : 1);
        break;
      }
      case 'hitBurst': {
        const [x, , z, caliber, shell] = args as [number, number, number, number, string | undefined];
        if (!this.allow('hit', 3, 0.5)) return;
        this.at('hit-burst', x, z, REACH.hit, shell === 'he' ? 1 : 0.85, 1.1 - Math.min(caliber, 0.4) * 0.3);
        break;
      }
      case 'armorSpark': {
        const [x, , z, caliber, glance] = args as [number, number, number, number, boolean | undefined];
        if (!this.allow('spark', 3, 0.5)) return;
        this.at(glance ? 'hit-ricochet' : 'hit-clang', x, z, REACH.hit, glance ? 0.7 : 0.9, 1.1 - Math.min(caliber, 0.4) * 0.3);
        break;
      }
      case 'explosion': {
        const [x, , z, scale] = args as [number, number, number, number];
        this.at('explosion-magazine', x, z, REACH.boom, Math.min(0.6 + 0.4 * (scale ?? 1), 1.2));
        this.out.duck(0.7, 3);
        break;
      }
      // A torpedo's hit is heard as the shell splash and the burst that `torpedoBlast` itself draws.
      case 'torpedoLaunch': {
        const [x, z] = args as [number, number];
        this.at('torpedo-launch', x, z, REACH.splash, 0.85);
        break;
      }
      case 'groundBurst': {
        const [x, , z] = args as [number, number, number];
        if (this.allow('ground', 2, 0.5)) this.at('hit-burst', x, z, REACH.hit, 0.6);
        break;
      }
      default:
        break;
    }
  }

  /** Per frame: the loops that follow the ship (the sea, the engines, the fires), and the sounds the state calls for. */
  update(dt: number, s: SoundState): void {
    this.clock += dt;
    this.state = s;
    if (!this.enabled) return;
    const pitch = slowPitch(s.timeScale);

    // The sea is always there, a little louder with the wind and the way she is making.
    this.bed('sea-loop', 0.3 + Math.min(s.wind / 30, 0.4) + 0.2 * s.speedFrac, pitch * (0.95 + 0.1 * s.speedFrac));
    // The engines follow the telegraph: a deeper note and a quieter one when she is stopped, a higher and fuller one at flank.
    this.bed('engine-loop', 0.12 + 0.5 * s.power, pitch * (0.78 + 0.5 * s.speedFrac));
    this.bed('prop-loop', 0.55 * s.speedFrac * s.speedFrac, pitch * (0.85 + 0.3 * s.speedFrac));
    this.bed('fire-loop', s.fires > 0 ? Math.min(1, 220 / (220 + s.fireDistance)) * (0.5 + 0.1 * Math.min(s.fires, 5)) : 0, pitch);
    this.bed('turret-motor', 0.28 * s.turretMotion, pitch);
    this.bed('plane-loop', s.planeDistance === null ? 0 : 0.5 * attenuation(s.planeDistance, 900), pitch);

    // The telegraph's bell, when the order is changed (not at the start).
    if (this.lastTelegraph !== null && s.telegraph !== this.lastTelegraph && this.allow('bell', 2, 1)) this.out.play(this.pick('telegraph-bell') ?? 'telegraph-bell', { gain: 0.7, bus: 'sfx' });
    this.lastTelegraph = s.telegraph;

    // A torpedo wake sighted: the alarm.
    if (s.threats > this.lastThreats && this.allow('klaxon', 1, 6)) this.out.play(this.pick('klaxon') ?? 'klaxon', { gain: 0.65 });
    this.lastThreats = s.threats;

    // A ship going down, where she is.
    if (s.sunk > this.lastSunk) {
      const r = s.sunkDistance;
      const g = attenuation(r, 2500);
      if (g > 0.03) this.out.play(this.pick('sinking') ?? 'sinking', { gain: Math.min(g * 1.2, 1), lowpass: r > 400 ? lowpassFor(r) : undefined, delay: soundDelay(r, this.delayScale) / this.timeScale });
    }
    this.lastSunk = s.sunk;

    // Water coming aboard.
    if (s.flooding && !this.wasFlooding) this.out.play(this.pick('flood') ?? 'flood', { gain: 0.7 });
    this.wasFlooding = s.flooding;

    // The hull speaks now and then when she is hurt or turning hard.
    this.nextCreak -= dt;
    if (this.nextCreak <= 0) {
      this.nextCreak = 22 + 25 * this.random();
      if ((s.damage > 0.15 || s.turning) && !s.paused) this.at('creak', s.listener.x, s.listener.z, 400, 0.35 + 0.4 * s.damage);
    }

    // An enemy shell coming down near: its whistle, once.
    for (const sh of s.incoming) {
      if (!sh.falling || sh.distance > 700 || this.whistled.has(sh.id)) continue;
      this.whistled.add(sh.id);
      this.out.play(this.pick('shell-whistle') ?? 'shell-whistle', { gain: Math.min(1, 0.4 + 300 / (300 + sh.distance)), rate: 0.95 + 0.1 * this.random(), pan: (this.random() - 0.5) * 1.2 });
    }
    if (this.whistled.size > 200) this.whistled.clear();
  }

  /** Keep a loop at its level, starting it the first time it is wanted and letting it go to nothing, not stopping, when it is not. */
  private bed(family: string, gain: number, rate: number): void {
    let handle = this.loops.get(family);
    if (!handle) {
      if (gain < 0.01 || !this.has(family)) return;
      const id = this.pick(family);
      // A loop asked for before its sound is decoded would be an empty one for good: wait until it can play.
      if (!id || this.out.ready?.(id) === false) return;
      handle = this.out.loop(id, { gain, rate, bus: 'ambience' });
      this.loops.set(family, handle);
    }
    handle.set({ gain, rate });
  }

  /** Stop everything that loops (the game is over, or the page is hidden). */
  silence(): void {
    for (const h of this.loops.values()) h.stop();
    this.loops.clear();
  }

  /** Is this one of the families, for the ones that the speed-dependent loops use? (For tests.) */
  static readonly SPEED_FAMILIES = SPEED_FAMILIES;
}
