import { describe, expect, it } from 'vitest';
import manifestJson from '../public/audio/voices/manifest.json';
import damageSource from '../src/sim/damage/ship-damage.ts?raw';
import gameSource from '../src/app/game.ts?raw';
import type { PlayOptions } from '../src/audio/director';
import { VOICE_RULES, VoiceDirector, type Spoken, type VoiceOut } from '../src/audio/voice';

class Out implements VoiceOut {
  played: { id: string; o: PlayOptions }[] = [];
  ducks: { amount: number; seconds: number; bus?: string }[] = [];
  notReady = new Set<string>();
  length = 2;
  play(id: string, o: PlayOptions = {}): void {
    this.played.push({ id, o });
  }
  duck(amount: number, seconds: number, bus?: string): void {
    this.ducks.push({ amount, seconds, bus });
  }
  ready(id: string): boolean {
    return !this.notReady.has(id);
  }
  duration(): number {
    return this.length;
  }
  get ids(): string[] {
    return this.played.map((p) => p.id);
  }
}

const MANIFEST = manifestJson as { sounds: Record<string, { role: string; text: string; duration: number; bus: string }> };
const IDS = Object.keys(MANIFEST.sounds);

function setup(random: () => number = () => 0) {
  const out = new Out();
  const spoken: Spoken[] = [];
  const v = new VoiceDirector(out, IDS, random, (s) => spoken.push(s));
  return { out, v, spoken };
}

/** Let `seconds` of real time go by, a frame at a time. */
function wait(v: VoiceDirector, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.1) v.update(0.1);
}

describe('voices: when a call is spoken', () => {
  it('speaks a call at once, on the voice bus, and gives way the effects and the ambience under it', () => {
    const { out, v } = setup();
    expect(v.cue('torpedo-port-bow')).toBe(true);
    expect(out.played).toHaveLength(1);
    expect(out.played[0]!.id).toMatch(/^voice-torpedo-port-bow-\d$/);
    expect(out.played[0]!.o.bus).toBe('voice');
    expect(out.ducks.map((d) => d.bus).sort()).toEqual(['ambience', 'sfx']);
    expect(out.ducks[0]!.seconds).toBeGreaterThan(out.length);
    expect(v.speaking).toBe(true);
  });

  it('does not repeat a call within its cooldown, and does after it', () => {
    const { out, v } = setup();
    v.cue('hit-taken');
    wait(v, 10);
    expect(v.cue('hit-taken')).toBe(false);
    wait(v, 40);
    expect(v.cue('hit-taken')).toBe(true);
    expect(out.played).toHaveLength(2);
  });

  it('counts the sides of a torpedo wake as one call', () => {
    const { out, v } = setup();
    v.cue('torpedo-port-bow');
    wait(v, 4);
    expect(v.cue('torpedo-stbd-bow')).toBe(false);
    wait(v, 10);
    expect(v.cue('torpedo-stbd-bow')).toBe(true);
    expect(out.played).toHaveLength(2);
  });

  it('says nothing that has no lines, or when the voices are off', () => {
    const { out, v } = setup();
    expect(v.cue('no-such-call')).toBe(false);
    v.enabled = false;
    expect(v.cue('sinking')).toBe(false);
    expect(out.played).toHaveLength(0);
  });

  it('does not spend a call on a line that has not arrived yet', () => {
    const { out, v } = setup();
    for (const id of IDS) out.notReady.add(id);
    expect(v.cue('fire')).toBe(false);
    out.notReady.clear();
    expect(v.cue('fire')).toBe(true);
  });

  it('does not say the same line twice running when there is another', () => {
    const first = setup(() => 0);
    first.v.cue('hit');
    wait(first.v, 45);
    first.v.cue('hit');
    expect(first.out.ids[0]).not.toBe(first.out.ids[1]);
  });

  it('says which call it was, and whether the words should be put in the log', () => {
    const { v, spoken } = setup();
    v.cue('sighted');
    wait(v, 10);
    v.cue('torpedo-ahead');
    expect(spoken.map((s) => [s.key, s.caption])).toEqual([
      ['sighted', true],
      ['torpedo-ahead', false],
    ]);
  });
});

describe('voices: sparingly', () => {
  it('drops colour while someone is speaking, and a moment after', () => {
    const { out, v } = setup();
    v.cue('torpedo-passed');
    expect(v.cue('hit')).toBe(false);
    wait(v, 2.4);
    expect(v.cue('hit')).toBe(false);
    wait(v, 6);
    expect(v.cue('hit')).toBe(true);
    expect(out.played).toHaveLength(2);
  });

  it('holds an important call until the speaker has finished, and then speaks it', () => {
    const { out, v } = setup();
    v.cue('torpedo-passed');
    expect(v.cue('fire')).toBe(true);
    expect(out.played).toHaveLength(1);
    // It speaks once the line is over and the air has been quiet for a moment.
    wait(v, 1.5);
    expect(out.played).toHaveLength(1);
    wait(v, 3);
    expect(out.played).toHaveLength(2);
    expect(out.ids[1]).toMatch(/^voice-fire-/);
  });

  it('lets go of a call that has waited too long', () => {
    const { out, v } = setup();
    out.length = 30;
    v.cue('torpedo-passed');
    v.cue('fire');
    wait(v, 12);
    expect(out.played).toHaveLength(1);
    out.length = 2;
    wait(v, 30);
    expect(out.played).toHaveLength(1);
  });

  it('lets a warning take the place of the news that is waiting', () => {
    const { out, v } = setup();
    v.cue('torpedo-passed');
    v.cue('fire');
    v.cue('torpedo-ahead');
    wait(v, 5);
    expect(out.ids[1]).toMatch(/^voice-torpedo-ahead-/);
  });

  it('keeps colour to a couple of lines a minute', () => {
    const { out, v } = setup();
    for (const key of ['hit', 'straddle', 'battery-fired', 'sighted']) {
      v.cue(key);
      wait(v, 8);
    }
    expect(out.played).toHaveLength(2);
    wait(v, 40);
    v.cue('battery-flash');
    expect(out.played).toHaveLength(3);
  });

  it('never holds back a warning for having spoken too much', () => {
    const { out, v } = setup();
    for (let i = 0; i < 6; i++) {
      v.cue('torpedo-ahead');
      wait(v, 14);
    }
    expect(out.played).toHaveLength(6);
  });

  it('says little in a long fight: a hundred calls of the news and the colour, a few lines', () => {
    const { out, v } = setup(() => 0.3);
    const keys = Object.keys(VOICE_RULES).filter((k) => VOICE_RULES[k]!.priority < 3);
    for (let i = 0; i < 100; i++) {
      v.cue(keys[(i * 7) % keys.length]!);
      wait(v, 3);
    }
    // 300 seconds, every key called over and over: no more than three lines a minute.
    expect(out.played.length).toBeLessThanOrEqual(16);
    expect(out.played.length).toBeGreaterThan(5);
  });

  it('keeps even the warnings to five a minute', () => {
    const { out, v } = setup();
    // A torpedo attack: a wake seen from a new side every few seconds, for two minutes.
    const sides = ['torpedo-ahead', 'torpedo-port-bow', 'torpedo-stbd-bow', 'torpedo-port-quarter', 'torpedo-stbd-quarter'];
    for (let i = 0; i < 30; i++) {
      v.cue(sides[i % sides.length]!);
      wait(v, 4);
    }
    expect(out.played.length).toBeLessThanOrEqual(10);
    expect(out.played.length).toBeGreaterThanOrEqual(6);
  });
});

describe('voices: the assets and the rules agree', () => {
  const lineKeys = new Set(IDS.map((id) => id.slice('voice-'.length).replace(/-\d+$/, '')));

  it('has a rule for every call there are lines for, and lines for every rule', () => {
    expect([...lineKeys].sort()).toEqual(Object.keys(VOICE_RULES).sort());
  });

  it('has every line on the voice bus, with a role and its words', () => {
    for (const [id, e] of Object.entries(MANIFEST.sounds)) {
      expect(e.bus, id).toBe('voice');
      expect(e.role, id).toBeTruthy();
      expect(e.text.length, id).toBeGreaterThan(5);
      expect(e.duration, id).toBeGreaterThan(0.4);
      expect(e.duration, id).toBeLessThan(4);
    }
  });

  it('has every call the game makes in the rules', () => {
    const source = `${gameSource}\n${damageSource}`;
    const called = new Set<string>();
    for (const m of source.matchAll(/this\.cue\('([a-z-]+)'\)/g)) called.add(m[1]!);
    // Reports carry theirs as the last argument: report('tone', `text`, at, 'cue').
    for (const m of source.matchAll(/, '([a-z-]+)'\);/g)) if (VOICE_RULES[m[1]!]) called.add(m[1]!);
    // The torpedo wake picks its side in one expression.
    for (const side of ['ahead', 'stbd-bow', 'stbd-quarter', 'port-bow', 'port-quarter']) called.add(`torpedo-${side}`);
    expect(called.size).toBeGreaterThan(20);
    for (const key of called) expect(VOICE_RULES[key], key).toBeDefined();
    // Every rule is called from somewhere.
    for (const key of Object.keys(VOICE_RULES)) {
      expect(source.includes(`'${key}'`) || source.includes(`torpedo-`), key).toBe(true);
    }
  });
});
