import { MISSIONS, PRACTICE, missionById, scoreMission, type MissionOutcome, type MissionScore } from './missions';
import { isPaceId, type PaceId } from '../sim/pace';
import { noRefits, nextRefitCost, REFITS, type RefitId, type RefitLevels } from './refits';

/** What the player has done: the prestige in hand, how each sortie went, and what the dockyard has fitted. */
export interface CampaignState {
  version: 1;
  prestige: number;
  /** For each sortie: how many times it has been won, and the best marks. */
  missions: Record<string, { wins: number; attempts: number; best: number }>;
  refits: RefitLevels;
  /** Every sortie open, whatever has been won (for practice and testing). */
  unlockAll: boolean;
  /** The practice courses the player has finished. */
  practice: Record<string, boolean>;
  /** How fast the sorties are fought: the real pace, or the quicker arcade one. */
  pace: PaceId;
}

const KEY = 'fall-of-shot.campaign';
/** What a sortie pays the second time it is won, and after. */
const REPEAT_PAY = 0.6;

/** The part of `localStorage` the campaign needs, so tests (and a browser that refuses storage) can stand in for it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function newCampaignState(): CampaignState {
  return { version: 1, prestige: 0, missions: {}, refits: noRefits(), unlockAll: false, practice: {}, pace: 'real' };
}

/** Read what was saved, tolerating anything: a blank slate when it is missing, damaged or from another version. */
export function parseCampaign(raw: string | null): CampaignState {
  const fresh = newCampaignState();
  if (!raw) return fresh;
  try {
    const d = JSON.parse(raw) as Partial<CampaignState>;
    if (!d || d.version !== 1) return fresh;
    const missions: CampaignState['missions'] = {};
    for (const [id, m] of Object.entries(d.missions ?? {})) {
      if (!missionById(id) || !m) continue;
      missions[id] = { wins: Math.max(Number(m.wins) || 0, 0), attempts: Math.max(Number(m.attempts) || 0, 0), best: Math.max(Number(m.best) || 0, 0) };
    }
    const refits = noRefits();
    for (const r of REFITS) refits[r.id] = Math.min(Math.max(Math.floor(Number(d.refits?.[r.id]) || 0), 0), r.levels.length);
    // A save from before the gunnery school has no practice record: nothing finished.
    const practice: Record<string, boolean> = {};
    for (const p of PRACTICE) if (d.practice?.[p.id] === true) practice[p.id] = true;
    // A save from before the pace switch has no pace: the real one.
    const pace: PaceId = isPaceId(d.pace) ? d.pace : 'real';
    return { version: 1, prestige: Math.max(Math.floor(Number(d.prestige) || 0), 0), missions, refits, unlockAll: d.unlockAll === true, practice, pace };
  } catch {
    return fresh;
  }
}

export interface Recorded {
  score: MissionScore;
  /** First win of this sortie: it opens the next. */
  firstWin: boolean;
  prestige: number;
}

/** The campaign: its state, the rules for what is open and what a refit costs, and where it is kept. */
export class Campaign {
  state: CampaignState;

  constructor(private readonly storage: StorageLike | null = null) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(KEY) ?? null;
    } catch {
      raw = null;
    }
    this.state = parseCampaign(raw);
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Private browsing and the like: the campaign carries on in memory.
    }
  }

  get prestige(): number {
    return this.state.prestige;
  }

  get levels(): RefitLevels {
    return this.state.refits;
  }

  /** The first sortie is always open; each later one opens when the one before it has been won. */
  isUnlocked(id: string): boolean {
    if (this.state.unlockAll) return true;
    const i = MISSIONS.findIndex((m) => m.id === id);
    if (i < 0) return false;
    if (i === 0) return true;
    return (this.state.missions[MISSIONS[i - 1]!.id]?.wins ?? 0) > 0;
  }

  record(id: string, outcome: MissionOutcome): Recorded {
    const mission = missionById(id);
    if (!mission) throw new Error(`unknown sortie ${id}`);
    const was = this.state.missions[id] ?? { wins: 0, attempts: 0, best: 0 };
    let score = scoreMission(mission, outcome);
    // A sortie already won pays less: the first time is the one the Admiralty remembers.
    if (outcome.result === 'victory' && was.wins > 0) {
      const total = score.lines.reduce((s, l) => s + l.fraction, 0);
      score = {
        prestige: Math.max(Math.round(mission.basePrestige * total * REPEAT_PAY), 1),
        lines: [...score.lines, { label: 'A sortie already won: the Admiralty pays less', fraction: -(1 - REPEAT_PAY) * total }],
      };
    }
    const firstWin = outcome.result === 'victory' && was.wins === 0;
    this.state.missions[id] = {
      wins: was.wins + (outcome.result === 'victory' ? 1 : 0),
      attempts: was.attempts + 1,
      best: Math.max(was.best, outcome.result === 'victory' ? score.prestige : 0),
    };
    this.state.prestige += score.prestige;
    this.save();
    return { score, firstWin, prestige: this.state.prestige };
  }

  /** Buy the next level of a refit, if the prestige is there. */
  buy(id: RefitId): boolean {
    const level = this.state.refits[id];
    const cost = nextRefitCost(id, level);
    if (cost === null || cost > this.state.prestige) return false;
    this.state.prestige -= cost;
    this.state.refits[id] = level + 1;
    this.save();
    return true;
  }

  /** Has the player finished this practice course? */
  practiceDone(id: string): boolean {
    return this.state.practice[id] === true;
  }

  finishPractice(id: string): void {
    if (this.state.practice[id]) return;
    this.state.practice[id] = true;
    this.save();
  }

  /** Choose how fast the sorties are fought. Wiping the campaign afresh does not change it: it is a way of playing, not progress. */
  setPace(pace: PaceId): void {
    if (this.state.pace === pace) return;
    this.state.pace = pace;
    this.save();
  }

  setUnlockAll(on: boolean): void {
    this.state.unlockAll = on;
    this.save();
  }

  reset(): void {
    const pace = this.state.pace;
    this.state = { ...newCampaignState(), pace };
    this.save();
  }
}
