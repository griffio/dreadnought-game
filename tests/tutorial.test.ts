import { describe, expect, it } from 'vitest';
import { correctionAdvice, GUNNERY_SCHOOL, Tutorial, type TutorialFrame } from '../src/app/tutorial';
import type { InputDevice } from '../src/input/intent';
import type { GunneryStatus, TrackQuality } from '../src/sim/gunnery/gunnery';
import type { SalvoReport, SpotCall } from '../src/sim/gunnery/spotting';

const DEVICES: InputDevice[] = ['keyboard-mouse', 'gamepad', 'touch'];

function report(salvo: number, call: SpotCall, meanRange = 0, meanDeflection = 0): SalvoReport {
  return { salvo, shells: [], hits: call === 'HIT' ? 1 : 0, meanRange, meanDeflection, call, text: `${call} ${Math.abs(meanRange)}` };
}

interface Knobs {
  target: boolean;
  quality: TrackQuality;
  autoSpot: boolean;
  corrections: { range: number; deflection: number };
  lastReport: SalvoReport | null;
  shellsFired: number;
  hitsScored: number;
  sightUp: boolean;
  down: boolean;
  now: number;
}

function world(): { k: Knobs; frame: () => TutorialFrame } {
  const k: Knobs = { target: false, quality: 'none', autoSpot: false, corrections: { range: 0, deflection: 0 }, lastReport: null, shellsFired: 0, hitsScored: 0, sightUp: false, down: false, now: 0 };
  const frame = (): TutorialFrame => ({
    status: {
      target: k.target
        ? { id: 2, name: 'SMS Hessen', range: 9100, bearingDeg: 342, relativeBearingDeg: -18, visible: true, hullDown: false, clarity: 1, spotted: false }
        : null,
      quality: k.quality,
      estimate: null,
      solution: k.target ? { azimuth: 0, elevation: 0.05, tof: 14.6, aimX: 0, aimZ: 0, range: 9100, valid: true, iterations: 3 } : null,
      corrections: k.corrections,
      autoSpot: k.autoSpot,
      turrets: [],
      bearingGuns: 4,
      armed: false,
      shellsInFlight: 0,
      nextSplashIn: null,
      lastReport: k.lastReport,
      reportAge: 0,
      shell: 'ap',
      shellChoice: true,
    } as GunneryStatus,
    shellsFired: k.shellsFired,
    hitsScored: k.hitsScored,
    sightUp: k.sightUp,
    targetDown: k.down,
    now: k.now,
  });
  return { k, frame };
}

describe('Gunnery School: the steps', () => {
  it('are in the order the player learns them, each with a title and words for every device', () => {
    expect(GUNNERY_SCHOOL.map((s) => s.id)).toEqual(['welcome', 'designate', 'plot', 'fire', 'flight', 'correct', 'bracket', 'auto', 'hits', 'sight', 'ruler', 'complete']);
    const { frame, k } = world();
    k.target = true;
    k.lastReport = report(1, 'SHORT', -240, 40);
    for (const s of GUNNERY_SCHOOL) {
      expect(s.title.length, s.id).toBeGreaterThan(5);
      for (const d of DEVICES) expect(s.text(d, frame(), null).length, `${s.id} on ${d}`).toBeGreaterThan(10);
    }
  });

  it('name the control in hand: Space, RT or the FIRE button', () => {
    const fire = GUNNERY_SCHOOL.find((s) => s.id === 'fire')!;
    const { frame } = world();
    expect(fire.text('keyboard-mouse', frame(), null)).toContain('Space');
    expect(fire.text('gamepad', frame(), null)).toContain('RT');
    expect(fire.text('touch', frame(), null)).toContain('FIRE');
    const pick = GUNNERY_SCHOOL.find((s) => s.id === 'designate')!;
    expect(pick.text('touch', frame(), null)).toMatch(/^Tap/);
    expect(pick.text('keyboard-mouse', frame(), null)).toMatch(/^Click/);
    expect(pick.text('gamepad', frame(), null)).toMatch(/RB/);
  });
});

describe('Gunnery School: telling the player what to correct', () => {
  it('says add range when the salvo fell short, and which control, and about how many presses', () => {
    const text = correctionAdvice('keyboard-mouse', report(1, 'SHORT', -240));
    expect(text).toContain('SHORT');
    expect(text).toContain('240 m');
    expect(text).toContain('E');
    expect(text).toMatch(/about 2 times/);
    expect(correctionAdvice('gamepad', report(1, 'SHORT', -240))).toContain('D-pad UP');
    expect(correctionAdvice('touch', report(1, 'SHORT', -240))).toContain('RANGE +');
  });

  it('says take range off when it fell over', () => {
    const text = correctionAdvice('keyboard-mouse', report(1, 'OVER', 480));
    expect(text).toContain('OVER');
    expect(text).toContain('Q');
    expect(text).toMatch(/about 5 times/);
    expect(correctionAdvice('touch', report(1, 'OVER', 480))).toContain('RANGE -');
  });

  it('says once when the miss is near, and adds the deflection only when it matters', () => {
    expect(correctionAdvice('keyboard-mouse', report(1, 'SHORT', -80))).toContain('once');
    expect(correctionAdvice('keyboard-mouse', report(1, 'SHORT', -240, 10))).not.toMatch(/left|right/i);
    // Shells that fell to her right want the aim moved left, which is the left deflection key.
    const right = correctionAdvice('keyboard-mouse', report(1, 'SHORT', -240, 80));
    expect(right).toContain('her right');
    expect(right).toContain('[');
    const left = correctionAdvice('keyboard-mouse', report(1, 'OVER', 240, -80));
    expect(left).toContain('her left');
    expect(left).toContain(']');
  });

  it('calls a straddle bracketed and asks for nothing', () => {
    const text = correctionAdvice('keyboard-mouse', report(1, 'STRADDLE', 20));
    expect(text).toMatch(/straddle/i);
    expect(text).toMatch(/No correction/);
  });
});

describe('Gunnery School: the coach', () => {
  it('waits on the welcome until the player is ready, whatever happens', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    k.target = true;
    k.quality = 'settled';
    t.update(frame());
    expect(t.step.id).toBe('welcome');
    t.next();
    expect(t.step.id).toBe('designate');
  });

  it('takes the player through every step as each is done, and finishes', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    t.update(frame());
    t.next();
    const seen: string[] = [t.step.id];
    const go = (mutate: () => void) => {
      mutate();
      k.now += 1;
      t.update(frame());
      seen.push(t.step.id);
    };
    expect(t.step.id).toBe('designate');
    go(() => (k.target = true));
    expect(t.step.id).toBe('plot');
    go(() => (k.quality = 'plotting'));
    expect(t.step.id).toBe('plot');
    go(() => (k.quality = 'settling'));
    expect(t.step.id).toBe('plot');
    go(() => (k.quality = 'settled'));
    expect(t.step.id).toBe('fire');
    go(() => (k.shellsFired = 8));
    expect(t.step.id).toBe('flight');
    go(() => (k.lastReport = report(1, 'SHORT', -300, 10)));
    expect(t.step.id).toBe('correct');
    expect(t.view(frame(), 'keyboard-mouse').text).toContain('SHORT');
    go(() => (k.corrections = { range: 200, deflection: 0 }));
    expect(t.step.id).toBe('bracket');
    go(() => (k.shellsFired = 16));
    expect(t.step.id).toBe('bracket');
    // A second report that is only another miss does not finish it; a straddle does.
    go(() => (k.lastReport = report(2, 'OVER', 100)));
    expect(t.step.id).toBe('bracket');
    go(() => (k.lastReport = report(3, 'STRADDLE', 10)));
    expect(t.step.id).toBe('auto');
    go(() => (k.autoSpot = true));
    expect(t.step.id).toBe('hits');
    go(() => (k.hitsScored = 2));
    expect(t.step.id).toBe('hits');
    expect(t.view(frame(), 'touch').text).toContain('2 of 3');
    go(() => (k.hitsScored = 3));
    expect(t.step.id).toBe('sight');
    go(() => (k.sightUp = true));
    // The ruler is read, not done: the coach waits for NEXT.
    expect(t.step.id).toBe('ruler');
    go(() => (k.now += 100));
    expect(t.step.id).toBe('ruler');
    expect(t.complete).toBe(false);
    t.next();
    expect(t.step.id).toBe('complete');
    expect(t.complete).toBe(true);
    expect(t.finished).toBe(false);
    t.next();
    expect(t.finished).toBe(true);
    expect(seen.length).toBeGreaterThan(10);
  });

  it('counts only what the player does after a step begins: an old report or an old correction does not finish it', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    k.target = true;
    k.quality = 'settled';
    k.shellsFired = 12;
    k.lastReport = report(4, 'SHORT', -200);
    k.corrections = { range: 300, deflection: 0 };
    t.update(frame());
    t.next();
    // Designated and settled already: it carries through to FIRE, and no further, because nothing has been fired since.
    t.update(frame());
    expect(t.step.id).toBe('fire');
    t.update(frame());
    expect(t.step.id).toBe('fire');
    k.shellsFired = 20;
    t.update(frame());
    expect(t.step.id).toBe('flight');
    // The old report (salvo 4) is not news; a new one is.
    t.update(frame());
    expect(t.step.id).toBe('flight');
    k.lastReport = report(5, 'OVER', 150);
    t.update(frame());
    expect(t.step.id).toBe('correct');
    // The correction already made does not count; a new one does.
    t.update(frame());
    expect(t.step.id).toBe('correct');
    k.corrections = { range: 150, deflection: 0 };
    t.update(frame());
    expect(t.step.id).toBe('bracket');
  });

  it('carries on through a step that is already done: auto-spot on before its step', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    k.target = true;
    k.quality = 'settled';
    k.autoSpot = true;
    t.update(frame());
    t.next();
    t.update(frame());
    expect(t.step.id).toBe('fire');
    k.shellsFired = 8;
    t.update(frame());
    k.lastReport = report(1, 'HIT', 0);
    t.update(frame());
    // A first-salvo hit is the correction done; to bracket her the player must fire again.
    expect(t.step.id).toBe('bracket');
    k.shellsFired = 16;
    k.lastReport = report(2, 'STRADDLE', 10);
    t.update(frame());
    // Bracketed; auto-spot is already on, so that step is done too and the next is the one to do.
    expect(t.step.id).toBe('hits');
  });

  it('counts the three hits from the step on: hits made while bracketing do not finish it', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    k.target = true;
    k.quality = 'settled';
    k.autoSpot = true;
    // Already three hits (the player's own corrections found her) when the step is reached.
    k.hitsScored = 3;
    k.shellsFired = 30;
    k.lastReport = report(6, 'HIT', 0);
    t.update(frame());
    t.next();
    // Walk to the step by hand.
    while (t.step.id !== 'hits') t.next();
    t.update(frame());
    expect(t.step.id).toBe('hits');
    expect(t.view(frame(), 'keyboard-mouse').text).toContain('0 of 3');
    k.hitsScored = 5;
    t.update(frame());
    expect(t.step.id).toBe('hits');
    expect(t.view(frame(), 'keyboard-mouse').text).toContain('2 of 3');
    k.hitsScored = 6;
    t.update(frame());
    expect(t.step.id).toBe('sight');
  });

  it('does not ask for hits on a ship that has gone down: it says so and goes on to the first step that needs no target', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    k.target = true;
    k.quality = 'settled';
    k.autoSpot = true;
    t.update(frame());
    t.next();
    while (t.step.id !== 'hits') t.next();
    t.update(frame());
    expect(t.step.id).toBe('hits');
    expect(t.view(frame(), 'keyboard-mouse').text).not.toMatch(/gone down/);
    k.down = true;
    t.update(frame());
    expect(t.step.id).toBe('sight');
    expect(t.view(frame(), 'keyboard-mouse').text).toMatch(/^She has gone down, so the shooting is over\./);
    // The notice belongs to the card she was passed to: it goes when the player moves on.
    k.sightUp = true;
    t.update(frame());
    expect(t.step.id).toBe('ruler');
    expect(t.view(frame(), 'keyboard-mouse').text).not.toMatch(/gone down/);
  });

  it('passes over every step that needs her when she goes down early, and stops at the one that does not', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    t.update(frame());
    t.next();
    k.target = true;
    t.update(frame());
    expect(t.step.id).toBe('plot');
    k.down = true;
    t.update(frame());
    // plot, fire, flight, correct and bracket all need a target; auto-spot does not, and it waits for the player.
    expect(t.step.id).toBe('auto');
    expect(t.view(frame(), 'touch').text).toMatch(/gone down/);
    k.autoSpot = true;
    t.update(frame());
    // The hits step needs her too, so it is passed over as well.
    expect(t.step.id).toBe('sight');
  });

  it('sends the player back to pick a target if the ship is un-designated mid-course', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    t.update(frame());
    t.next();
    k.target = true;
    t.update(frame());
    expect(t.step.id).toBe('plot');
    k.target = false;
    const v = t.view(frame(), 'touch');
    expect(v.text).toMatch(/no longer designated/);
    expect(v.text).toContain('Tap');
    k.target = true;
    expect(t.view(frame(), 'touch').text).not.toMatch(/no longer designated/);
  });

  it('offers SKIP only after the step has taken a while, and skipping goes on', () => {
    const { k, frame } = world();
    const t = new Tutorial();
    t.update(frame());
    t.next();
    k.target = true;
    k.now = 10;
    t.update(frame());
    expect(t.step.id).toBe('plot');
    k.now = 20;
    expect(t.view(frame(), 'keyboard-mouse').canSkip).toBe(false);
    k.now = 10 + 46;
    expect(t.view(frame(), 'keyboard-mouse').canSkip).toBe(true);
    t.next();
    expect(t.step.id).toBe('fire');
    // A manual card never offers SKIP: it has NEXT.
    expect(new Tutorial().view(frame(), 'keyboard-mouse').canSkip).toBe(false);
    expect(new Tutorial().view(frame(), 'keyboard-mouse').manual).toBe(true);
  });

  it('points at the part of the HUD each step is about', () => {
    const t = new Tutorial();
    const { frame } = world();
    const focus = (id: string) => GUNNERY_SCHOOL.find((s) => s.id === id)!.focus;
    expect(focus('designate')).toBe('target');
    expect(focus('plot')).toBe('plot');
    expect(focus('fire')).toBe('fire');
    expect(focus('correct')).toBe('range');
    expect(focus('auto')).toBe('auto');
    expect(focus('sight')).toBe('sight');
    expect(focus('ruler')).toBe('ruler');
    expect(t.view(frame(), 'touch').focus).toBeNull();
  });
});
