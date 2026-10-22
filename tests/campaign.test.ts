import { describe, expect, it } from 'vitest';
import { Campaign, parseCampaign, type StorageLike } from '../src/campaign/campaign';
import { MISSIONS, PRACTICE, missionById, practiceById, scoreMission, type MissionOutcome } from '../src/campaign/missions';
import { isShipId } from '../src/data/ships/roster';
import { applyRefits, nextRefitCost, noRefits, REFITS } from '../src/campaign/refits';
import { DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { RANGEFINDER_15FT, RANGEFINDER_30FT } from '../src/sim/gunnery/rangefinder';

class Memory implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const win = (over: Partial<MissionOutcome> = {}): MissionOutcome => ({
  result: 'victory',
  how: 'SMS Hessen was sunk.',
  seconds: 900,
  shellsFired: 100,
  hitsScored: 12,
  hitsTaken: 4,
  dishonour: 0,
  condition: 0.9,
  ...over,
});

describe('the sorties', () => {
  it('are six, in order, each with orders and a par', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(['trials', 'torpedo-boats', 'narrows', 'run-to-the-south', 'denmark-strait', 'last-stand']);
    for (const m of MISSIONS) {
      expect(m.briefing.length).toBeGreaterThan(1);
      expect(m.objective.length).toBeGreaterThan(10);
      expect(m.basePrestige).toBeGreaterThan(0);
    }
    expect(missionById('narrows')!.scenario).toBe('narrows');
    expect(missionById('nope')).toBeNull();
  });

  it('each puts her in a ship that exists, against a foe that exists', () => {
    for (const m of MISSIONS) {
      expect(m.ship === undefined || isShipId(m.ship), m.id).toBe(true);
      const foe = m.params?.foe;
      expect(foe === undefined || isShipId(foe), m.id).toBe(true);
    }
    expect(missionById('trials')!.ship).toBeUndefined();
    expect(missionById('narrows')!.ship).toBe('queen-elizabeth');
    expect(missionById('run-to-the-south')!.ship).toBe('queen-elizabeth');
    expect(missionById('denmark-strait')!.ship).toBe('king-george-v');
    expect(missionById('last-stand')!.ship).toBe('rodney');
  });

  it('a disabled enemy earns the Admiralty\'s bonus only where it asked for one', () => {
    const last = missionById('last-stand')!;
    const strait = missionById('denmark-strait')!;
    const plain = scoreMission(last, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'sunk' })).prestige;
    const disabled = scoreMission(last, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'disabled', disabled: true }));
    expect(disabled.prestige).toBeGreaterThan(plain);
    expect(disabled.lines.map((l) => l.label).join(' ')).toMatch(/helpless/);
    const elsewhere = scoreMission(strait, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'disabled', disabled: true }));
    expect(elsewhere.prestige).toBe(strait.basePrestige);
  });

  it('a clean, quick, accurate win earns the full bonuses, and a poor one the base', () => {
    const m = missionById('trials')!;
    const best = scoreMission(m, win());
    expect(best.prestige).toBeGreaterThanOrEqual(m.basePrestige * 1.5);
    expect(best.lines.map((l) => l.label).join(' ')).toMatch(/gunnery/);
    const poor = scoreMission(m, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'sunk' }));
    expect(poor.prestige).toBe(m.basePrestige);
  });

  it('honouring a surrender earns a little, firing on the struck costs a good deal', () => {
    const m = missionById('trials')!;
    const base = scoreMission(m, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'sunk' })).prestige;
    const honour = scoreMission(m, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'SMS Hessen struck her colours.' })).prestige;
    const shame = scoreMission(m, win({ hitsScored: 1, condition: 0.3, seconds: 5000, how: 'SMS Hessen struck her colours.', dishonour: 4 })).prestige;
    expect(honour).toBeGreaterThan(base);
    expect(shame).toBeLessThan(base);
    expect(shame).toBeGreaterThanOrEqual(1);
  });

  it('a lost ship still pays a quarter, so that the dockyard can help next time', () => {
    const m = missionById('narrows')!;
    const lost = scoreMission(m, win({ result: 'defeat' }));
    expect(lost.prestige).toBe(Math.round(m.basePrestige * 0.25));
  });
});

describe('the campaign', () => {
  it('opens the first sortie, and each next one when the one before is won', () => {
    const c = new Campaign(new Memory());
    expect(c.isUnlocked('trials')).toBe(true);
    expect(c.isUnlocked('torpedo-boats')).toBe(false);
    expect(c.isUnlocked('narrows')).toBe(false);
    // A defeat does not open anything.
    c.record('trials', win({ result: 'defeat' }));
    expect(c.isUnlocked('torpedo-boats')).toBe(false);
    const r = c.record('trials', win());
    expect(r.firstWin).toBe(true);
    expect(c.isUnlocked('torpedo-boats')).toBe(true);
    expect(c.isUnlocked('narrows')).toBe(false);
    expect(c.record('trials', win()).firstWin).toBe(false);
    c.setUnlockAll(true);
    expect(c.isUnlocked('narrows')).toBe(true);
  });

  it('pays less the second time a sortie is won', () => {
    const c = new Campaign(new Memory());
    const first = c.record('trials', win());
    const second = c.record('trials', win());
    expect(second.score.prestige).toBeLessThan(first.score.prestige);
    expect(second.score.prestige).toBe(Math.round(first.score.prestige * 0.6));
    expect(second.score.lines.some((l) => /already won/.test(l.label))).toBe(true);
    // A loss is not a repeat win: it pays as a loss always does.
    expect(c.record('trials', win({ result: 'defeat' })).score.prestige).toBe(Math.round(missionById('trials')!.basePrestige * 0.25));
  });

  it('keeps the prestige and the best marks, and remembers across a restart', () => {
    const store = new Memory();
    const c = new Campaign(store);
    const r = c.record('trials', win());
    expect(c.prestige).toBe(r.score.prestige);
    c.record('trials', win({ hitsScored: 0, condition: 0.2, seconds: 9000, how: 'sunk' }));
    expect(c.state.missions['trials']!.best).toBe(r.score.prestige);
    expect(c.state.missions['trials']!.attempts).toBe(2);
    const again = new Campaign(store);
    expect(again.prestige).toBe(c.prestige);
    expect(again.state.missions['trials']!.wins).toBe(2);
  });

  it('a refit is bought level by level, for the prestige, and not past the last', () => {
    const c = new Campaign(new Memory());
    expect(c.buy('rangefinder')).toBe(false);
    c.state.prestige = 100;
    expect(c.buy('rangefinder')).toBe(true);
    expect(c.levels.rangefinder).toBe(1);
    expect(c.prestige).toBe(100 - nextRefitCost('rangefinder', 0)!);
    expect(c.buy('rangefinder')).toBe(true);
    expect(c.buy('rangefinder')).toBe(false);
    expect(c.levels.rangefinder).toBe(2);
  });

  it('survives damaged or foreign storage, and storage that throws', () => {
    expect(parseCampaign('not json').prestige).toBe(0);
    expect(parseCampaign(JSON.stringify({ version: 9, prestige: 50 })).prestige).toBe(0);
    const odd = parseCampaign(JSON.stringify({ version: 1, prestige: -5, missions: { trials: { wins: 'x' }, ghost: { wins: 3 } }, refits: { rangefinder: 7, flash: -2 } }));
    expect(odd.prestige).toBe(0);
    expect(Object.keys(odd.missions)).toEqual(['trials']);
    expect(odd.refits.rangefinder).toBe(2);
    expect(odd.refits.flash).toBe(0);
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('no storage');
      },
      setItem: () => {
        throw new Error('no storage');
      },
    };
    const c = new Campaign(hostile);
    expect(() => c.record('trials', win())).not.toThrow();
    expect(c.prestige).toBeGreaterThan(0);
  });
});

describe('the gunnery school', () => {
  it('is practice: always open, outside the order of the sorties, and paying nothing', () => {
    expect(PRACTICE.map((p) => p.id)).toEqual(['gunnery-school']);
    const school = practiceById('gunnery-school')!;
    expect(school.practice).toBe(true);
    expect(school.basePrestige).toBe(0);
    expect(MISSIONS.some((m) => m.id === school.id)).toBe(false);
    expect(missionById('gunnery-school')).toBeNull();
    expect(practiceById('trials')).toBeNull();
    // A passive Hessen across the bows, at a range the plot can settle on.
    expect(school.params).toMatchObject({ passive: '1', trange: '9' });
    const c = new Campaign(new Memory());
    // The first sortie is open without it.
    expect(c.isUnlocked('trials')).toBe(true);
    expect(c.isUnlocked('gunnery-school')).toBe(false);
  });

  it('is remembered once done, and across a restart', () => {
    const store = new Memory();
    const c = new Campaign(store);
    expect(c.practiceDone('gunnery-school')).toBe(false);
    c.finishPractice('gunnery-school');
    expect(c.practiceDone('gunnery-school')).toBe(true);
    expect(new Campaign(store).practiceDone('gunnery-school')).toBe(true);
    // It pays nothing and does not touch the sorties.
    expect(c.prestige).toBe(0);
    expect(Object.keys(c.state.missions)).toEqual([]);
    c.reset();
    expect(c.practiceDone('gunnery-school')).toBe(false);
  });

  it('is tolerated missing from an older save, and unknown courses are dropped', () => {
    const old = parseCampaign(JSON.stringify({ version: 1, prestige: 12, missions: {}, refits: {}, unlockAll: false }));
    expect(old.practice).toEqual({});
    expect(old.prestige).toBe(12);
    const odd = parseCampaign(JSON.stringify({ version: 1, practice: { 'gunnery-school': true, ghost: true, other: 'yes' } }));
    expect(odd.practice).toEqual({ 'gunnery-school': true });
  });
});

describe('the refits', () => {
  it('leave the ship as built at level zero, and do not touch the original', () => {
    const same = applyRefits(DREADNOUGHT_SETUP, noRefits());
    expect(same.rangefinder).toBe(DREADNOUGHT_SETUP.rangefinder);
    expect(same.damage.flashProtection).toBe(DREADNOUGHT_SETUP.damage.flashProtection);
    expect(same.damage.parties).toBe(DREADNOUGHT_SETUP.damage.parties);
  });

  it('change the instruments and the damage plan, level by level', () => {
    const one = applyRefits(DREADNOUGHT_SETUP, { rangefinder: 1, flash: 1, bulges: 1, 'damage-control': 1 });
    const two = applyRefits(DREADNOUGHT_SETUP, { rangefinder: 2, flash: 2, bulges: 2, 'damage-control': 2 });
    expect(one.rangefinder).toBe(RANGEFINDER_15FT);
    expect(two.rangefinder).toBe(RANGEFINDER_30FT);
    expect(one.damage.flashProtection).toBeGreaterThan(0.3);
    expect(two.damage.flashProtection).toBeGreaterThan(one.damage.flashProtection);
    expect(two.damage.torpedoProtection!).toBeGreaterThan(one.damage.torpedoProtection!);
    expect(two.damage.parties).toBe(DREADNOUGHT_SETUP.damage.parties + 2);
    expect(two.damage.pumpTonnesPerSecond).toBeGreaterThan(one.damage.pumpTonnesPerSecond);
    // The original is untouched.
    expect(DREADNOUGHT_SETUP.damage.flashProtection).toBe(0);
    expect(DREADNOUGHT_SETUP.damage.torpedoProtection).toBeUndefined();
  });

  it('are priced, and each has two levels', () => {
    for (const r of REFITS) {
      expect(r.levels.length).toBe(2);
      expect(r.levels[1]!.cost).toBeGreaterThan(r.levels[0]!.cost);
    }
  });
});
