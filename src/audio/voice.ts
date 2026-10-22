import type { Bus, PlayOptions } from './director';

/**
 * How a call from the crew is treated. A key is a family of voice lines (`voice-hit-taken-1`, `-2`, `-3` are the key 'hit-taken').
 *
 * `priority` decides what may wait and what is dropped: 3 is a warning the player must hear (a torpedo wake, the ship going down),
 * 2 is news worth hearing a moment late (an enemy gone, a fire), 1 and 0 are colour that is dropped if anyone is speaking.
 * `cooldown` is the least time between two calls of the key (or of its `group`), in seconds; `caption` puts the words in the ship's
 * log, for the calls that the log does not already make in writing.
 */
export interface VoiceRule {
  priority: 0 | 1 | 2 | 3;
  cooldown: number;
  group?: string;
  caption?: boolean;
}

const wake: VoiceRule = { priority: 3, cooldown: 14, group: 'torpedo-wake' };

export const VOICE_RULES: Readonly<Record<string, VoiceRule>> = {
  'torpedo-ahead': wake,
  'torpedo-port-bow': wake,
  'torpedo-stbd-bow': wake,
  'torpedo-port-quarter': wake,
  'torpedo-stbd-quarter': wake,
  'enemy-torpedoes': { priority: 2, cooldown: 20 },
  'torpedo-passed': { priority: 1, cooldown: 25 },
  sighted: { priority: 1, cooldown: 60, caption: true },
  aground: { priority: 3, cooldown: 30 },
  hit: { priority: 1, cooldown: 40 },
  straddle: { priority: 1, cooldown: 70 },
  'enemy-fire': { priority: 1, cooldown: 60, caption: true },
  'enemy-blown': { priority: 2, cooldown: 10, group: 'enemy-end' },
  'enemy-sinking': { priority: 2, cooldown: 10, group: 'enemy-end' },
  'enemy-struck': { priority: 2, cooldown: 10, group: 'enemy-end' },
  'enemy-disabled': { priority: 2, cooldown: 10, group: 'enemy-end' },
  'enemy-broke-off': { priority: 1, cooldown: 10, group: 'enemy-end' },
  'battery-silenced': { priority: 2, cooldown: 15 },
  'battery-fired': { priority: 1, cooldown: 60 },
  'battery-flash': { priority: 1, cooldown: 40 },
  'hit-taken': { priority: 1, cooldown: 45, caption: true },
  fire: { priority: 2, cooldown: 40 },
  flooding: { priority: 2, cooldown: 40 },
  'turret-out': { priority: 2, cooldown: 25 },
  steering: { priority: 2, cooldown: 60 },
  sinking: { priority: 3, cooldown: 60 },
  airborne: { priority: 1, cooldown: 30 },
  'fort-found': { priority: 1, cooldown: 20 },
  mines: { priority: 2, cooldown: 60 },
  returning: { priority: 0, cooldown: 30 },
};

/** The least quiet before a line, by priority: a warning goes straight on, colour waits for the air to clear. */
const QUIET = [6, 5, 2, 0.3] as const;
/** The most lines, of any priority, that may have been spoken in the last minute for a call of this priority to be spoken: colour yields first, then news, then warnings. */
const PER_MINUTE = [1, 2, 3, 5] as const;
/** How long a call waits for its turn before it is dropped as stale. */
const PATIENCE = [0, 0, 5, 8] as const;
/** How much the effects and the ambience give way under a voice. */
const DUCK = { ambience: 0.5, sfx: 0.35 } as const;

/** What the director needs of the audio engine. */
export interface VoiceOut {
  play(id: string, o?: PlayOptions): void;
  duck(amount: number, seconds: number, bus?: Bus): void;
  /** Whether a line can be played now (the page has been touched and it is decoded). */
  ready?(id: string): boolean;
  /** How long a line is, seconds. */
  duration?(id: string): number;
}

export interface Spoken {
  id: string;
  key: string;
  /** Put the words in the log. */
  caption: boolean;
}

interface Waiting {
  key: string;
  rule: VoiceRule;
  at: number;
}

/**
 * The crew's voices, used sparingly. Parts of the game call out what happens (`cue`); this decides whether anyone says it. One voice
 * at a time; a call is dropped when someone is speaking unless it is important enough to wait; the same call is not repeated within
 * its cooldown; and only a few lines are spoken in any minute, so that the crew is heard when it counts and not as a running commentary.
 */
export class VoiceDirector {
  private readonly families = new Map<string, string[]>();
  private clock = 0;
  private busyUntil = 0;
  private lastEnd = -Infinity;
  private waiting: Waiting | null = null;
  private readonly lastSaid = new Map<string, number>();
  private readonly lastLine = new Map<string, string>();
  private readonly recent: { at: number }[] = [];
  /** When false nothing is said (the player has turned the voices off). */
  enabled = true;

  constructor(
    private readonly out: VoiceOut,
    ids: readonly string[],
    private readonly random: () => number = Math.random,
    private readonly onSpoken: (line: Spoken) => void = () => {},
  ) {
    for (const id of ids) {
      if (!id.startsWith('voice-')) continue;
      const key = id.slice('voice-'.length).replace(/-\d+$/, '');
      const list = this.families.get(key) ?? [];
      list.push(id);
      this.families.set(key, list);
    }
  }

  /** Is anyone speaking? */
  get speaking(): boolean {
    return this.clock < this.busyUntil;
  }

  /** A call from the crew. Returns true when it was spoken now or is waiting its turn. */
  cue(key: string): boolean {
    const rule = VOICE_RULES[key];
    if (!this.enabled || !rule || !this.families.has(key)) return false;
    const group = rule.group ?? key;
    const said = this.lastSaid.get(group);
    if (said !== undefined && this.clock - said < rule.cooldown) return false;
    if (this.waiting?.rule.group === rule.group && rule.group !== undefined) return false;
    if (this.overRate(rule.priority)) return false;
    if (this.canSpeak(rule.priority)) return this.say(key, rule);
    // Someone is speaking, or has only just stopped: an important call waits its turn, anything else is dropped.
    if (rule.priority >= 2) {
      if (!this.waiting || rule.priority > this.waiting.rule.priority) this.waiting = { key, rule, at: this.clock };
      return this.waiting.key === key;
    }
    return false;
  }

  /** Move the clock on (real seconds) and speak the call that has been waiting, if it is its turn. */
  update(dt: number): void {
    this.clock += dt;
    const w = this.waiting;
    if (!w) return;
    if (this.clock - w.at > PATIENCE[w.rule.priority]) {
      this.waiting = null;
      return;
    }
    if (this.canSpeak(w.rule.priority)) {
      this.waiting = null;
      // Its turn has come, but the crew may have spoken enough in the meantime.
      if (!this.overRate(w.rule.priority)) this.say(w.key, w.rule);
    }
  }

  private canSpeak(priority: number): boolean {
    return this.clock >= this.busyUntil && this.clock - this.lastEnd >= QUIET[priority]!;
  }

  private overRate(priority: number): boolean {
    const cap = PER_MINUTE[priority]!;
    if (!Number.isFinite(cap)) return false;
    return this.recent.filter((r) => this.clock - r.at < 60).length >= cap;
  }

  private say(key: string, rule: VoiceRule): boolean {
    const list = this.families.get(key)!;
    // Not the line said last time, when there is another to say.
    const last = this.lastLine.get(key);
    const choices = list.length > 1 ? list.filter((id) => id !== last) : list;
    const id = choices[Math.floor(this.random() * choices.length) % choices.length]!;
    // A line that cannot be played yet (the sounds are still arriving) is not spent.
    if (this.out.ready?.(id) === false) return false;
    const seconds = this.out.duration?.(id) || 2;
    this.out.play(id, { gain: 1, bus: 'voice' });
    this.out.duck(DUCK.ambience, seconds + 0.3, 'ambience');
    this.out.duck(DUCK.sfx, seconds + 0.3, 'sfx');
    this.busyUntil = this.clock + seconds + 0.25;
    this.lastEnd = this.busyUntil;
    this.lastSaid.set(rule.group ?? key, this.clock);
    this.lastLine.set(key, id);
    this.recent.push({ at: this.clock });
    if (this.recent.length > 40) this.recent.shift();
    this.onSpoken({ id, key, caption: rule.caption === true });
    return true;
  }
}
