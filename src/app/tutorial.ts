import type { InputDevice } from '../input/intent';
import type { GunneryStatus } from '../sim/gunnery/gunnery';
import type { SalvoReport } from '../sim/gunnery/spotting';

/** What the tutorial can see of the fight, each frame. */
export interface TutorialFrame {
  status: GunneryStatus;
  shellsFired: number;
  hitsScored: number;
  /** The director's sight is up. */
  sightUp: boolean;
  /** The target is beaten (sunk, sinking, blown up or struck): there is nothing left to shoot at. */
  targetDown: boolean;
  /** Simulation seconds. */
  now: number;
}

/** What was so when a step began: a step is done by what the player does after it, not by what was already the case. */
export interface StepMemory {
  at: number;
  shells: number;
  hits: number;
  /** The last salvo reported when the step began (-1: none). */
  salvo: number;
  range: number;
  deflection: number;
}

/** The part of the HUD to point at while a step is on. */
export type Focus = 'target' | 'plot' | 'fire' | 'range' | 'auto' | 'sight' | 'ruler' | null;

export interface TutorialStep {
  id: string;
  title: string;
  /** What to do, in the words of the device in hand. `m` is what was so when the step began, if it has. */
  text(device: InputDevice, f: TutorialFrame, m: StepMemory | null): string;
  /** Why it matters. */
  why?: string;
  focus: Focus;
  /** A step with nothing to do: the player reads it and goes on. */
  manual?: boolean;
  /** The step needs a target designated; without one the card sends the player back to pick it. */
  needsTarget?: boolean;
  /** Whether the player has done it. */
  done(f: TutorialFrame, m: StepMemory): boolean;
  /** Seconds before SKIP appears (default 25). */
  skipAfter?: number;
}

export interface TutorialView {
  index: number;
  count: number;
  id: string;
  title: string;
  text: string;
  why: string | null;
  focus: Focus;
  manual: boolean;
  canSkip: boolean;
  /** The last card: the school is complete. */
  last: boolean;
  /** The player has left the last card: nothing more to show. */
  finished: boolean;
}

/** The words for a control, by device. */
/** How to load the other round, by device. */
const SHELL_HOW: Record<InputDevice, string> = {
  'keyboard-mouse': 'Pressing 2 (1 goes back to armour-piercing)',
  gamepad: 'Holding LT and pressing A (again to go back)',
  touch: 'Tapping SHELL (again to go back)',
};

const KEYS: Record<InputDevice, { more: string; less: string; left: string; right: string; fire: string; auto: string; sight: string; pick: string }> = {
  'keyboard-mouse': { more: 'E', less: 'Q', left: '[', right: ']', fire: 'Space', auto: 'T', sight: 'the right mouse button (or V)', pick: 'Click' },
  gamepad: { more: 'D-pad UP', less: 'D-pad DOWN', left: 'D-pad LEFT', right: 'D-pad RIGHT', fire: 'RT', auto: 'A', sight: 'LT', pick: 'Press RB to select' },
  touch: { more: 'RANGE +', less: 'RANGE -', left: 'DEFL L', right: 'DEFL R', fire: 'FIRE', auto: 'AUTO SPOT', sight: 'SIGHT', pick: 'Tap' },
};

const metres = (m: number): string => `${Math.round(Math.abs(m) / 10) * 10} m`;

/** What to do about where the last salvo fell. */
export function correctionAdvice(device: InputDevice, r: SalvoReport): string {
  const k = KEYS[device];
  if (r.call === 'HIT' || r.call === 'STRADDLE') {
    return `${r.call === 'HIT' ? 'A hit!' : 'A straddle!'} Shells fell on both sides of her, so she is bracketed. No correction is needed: fire again.`;
  }
  const steps = Math.max(Math.round(Math.abs(r.meanRange) / 100), 1);
  const along =
    r.meanRange < 0
      ? `Your salvo fell SHORT by about ${metres(r.meanRange)}. Add range: press ${k.more} ${steps === 1 ? 'once' : `about ${steps} times`} (100 m a press).`
      : `Your salvo fell OVER by about ${metres(r.meanRange)}. Take range off: press ${k.less} ${steps === 1 ? 'once' : `about ${steps} times`} (100 m a press).`;
  if (Math.abs(r.meanDeflection) < 30) return along;
  // Shells that fell to the right of her want the aim moved left.
  const across = r.meanDeflection > 0 ? `They also fell to her right: press ${k.left} to move the aim left (10 m a press).` : `They also fell to her left: press ${k.right} to move the aim right (10 m a press).`;
  return `${along} ${across}`;
}

const reported = (f: TutorialFrame, m: StepMemory): SalvoReport | null => {
  const r = f.status.lastReport;
  return r && r.salvo !== m.salvo ? r : null;
};

/**
 * Gunnery School: ten things to do, in order, against a target that does not fire back. Each step finishes itself when the
 * player does it, so the card reads as a coach and not a manual. The step texts speak of the control in hand.
 */
export const GUNNERY_SCHOOL: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'WELCOME TO GUNNERY SCHOOL',
    manual: true,
    focus: null,
    text: () =>
      'SMS Hessen is ahead of you, steaming at six knots. She will not fire back and you cannot lose: this is the place to learn how a battleship’s guns are aimed. Each step finishes by itself when you do it.',
    why: 'A battleship does not aim a gun: she lays a whole battery on a target that is moving, thirty seconds away from the shells, over the horizon’s curve.',
    done: () => false,
  },
  {
    id: 'designate',
    title: '1. PICK A TARGET',
    focus: 'target',
    text: (d) => `${KEYS[d].pick} SMS Hessen${d === 'keyboard-mouse' ? ' (Tab cycles through the ships)' : ''}.`,
    why: 'You never aim at a crosshair. You tell the gunnery officer which ship to shoot at, and the fire-control table does the rest.',
    done: (f) => f.status.target !== null,
  },
  {
    id: 'plot',
    title: '2. LET THE PLOT SETTLE',
    focus: 'plot',
    needsTarget: true,
    skipAfter: 45,
    text: (_d, f) => {
      const t = f.status.target;
      const s = f.status.solution;
      const facts = t && s ? ` She is ${(t.range / 1000).toFixed(1)} km off: guns laid ${((s.elevation * 180) / Math.PI).toFixed(1)}° up, shells take ${Math.round(s.tof)} s.` : '';
      return `The rangefinder reads her range and the plot works out her course and speed. Wait until it says SETTLED.${facts}`;
    },
    why: 'The rangefinder’s error grows with the square of the range, and it keeps a small fixed error that no amount of averaging removes. Only the fall of shot can.',
    done: (f) => f.status.quality === 'settled',
  },
  {
    id: 'fire',
    title: '3. FIRE A SALVO',
    focus: 'fire',
    needsTarget: true,
    text: (d) =>
      d === 'touch'
        ? 'Tap FIRE. The ring fills as the turrets load, and the guns go when enough are ready. Hold it to keep firing.'
        : `Press ${KEYS[d].fire}. The guns go when enough turrets bear and are loaded. Hold it to keep firing.`,
    why: 'At this range the arc is shallow, nearly direct fire. Further out the guns are lifted higher and the shells come down steeply, which is plunging fire.',
    done: (f, m) => f.shellsFired > m.shells,
  },
  {
    id: 'flight',
    title: '4. WATCH THE FALL OF SHOT',
    focus: 'target',
    needsTarget: true,
    skipAfter: 40,
    text: (_d, f) => {
      const eta = f.status.nextSplashIn;
      return `The shells are in the air${eta !== null ? `: the first splash is due in about ${Math.ceil(eta)} s` : ''}. Watch the sea round her: the call will be SHORT, OVER or STRADDLE, and by how many metres.`;
    },
    why: 'Shells take fifteen to forty seconds to arrive, so you always aim where she will be, and you only learn how you did long after.',
    done: (f, m) => reported(f, m) !== null,
  },
  {
    id: 'correct',
    title: '5. CORRECT YOUR AIM',
    focus: 'range',
    needsTarget: true,
    text: (d, f) => (f.status.lastReport ? correctionAdvice(d, f.status.lastReport) : 'Use the range and deflection controls to move the next salvo.'),
    why: 'The first salvo is never right. You move the aim by what you saw, and each correction brings the next closer.',
    done: (f, m) => {
      const r = f.status.lastReport;
      const straddled = r !== null && (r.call === 'STRADDLE' || r.call === 'HIT');
      return straddled || f.status.autoSpot || f.status.corrections.range !== m.range || f.status.corrections.deflection !== m.deflection;
    },
  },
  {
    id: 'bracket',
    title: '6. BRACKET HER',
    focus: 'fire',
    needsTarget: true,
    skipAfter: 90,
    text: (d, f) => {
      const r = f.status.lastReport;
      void d;
      return `Fire again, read the call and correct. Short and then over means she is bracketed: split the difference. Carry on until a salvo straddles her or hits.${r ? ` (Last call: ${r.text}.)` : ''}`;
    },
    why: 'Bracketing is how every gunnery officer found the range: close the miss by halves until the shells are falling on her.',
    done: (f, m) => {
      const r = reported(f, m);
      return (r !== null && (r.call === 'STRADDLE' || r.call === 'HIT')) || f.hitsScored > m.hits;
    },
  },
  {
    id: 'auto',
    title: '7. LET THE GUNNERY OFFICER SPOT',
    focus: 'auto',
    text: (d) => `${d === 'touch' ? 'Tap' : 'Press'} ${KEYS[d].auto}. With auto-spot on, he applies the corrections himself after every salvo.`,
    why: 'He is steady and never tired, but he is slower than a good officer who can see the splashes. It frees you to steer and watch the sea.',
    done: (f) => f.status.autoSpot,
  },
  {
    id: 'hits',
    title: '8. LAND THREE MORE HITS',
    focus: 'fire',
    needsTarget: true,
    skipAfter: 120,
    // Hits made from here on: the ones from bracketing her were made with the player's own corrections.
    text: (d, f, m) => `Keep firing with auto-spot on until three more shells have hit her (${Math.min(f.hitsScored - (m?.hits ?? 0), 3)} of 3). ${d === 'touch' ? 'Tap FIRE for each salvo.' : `${KEYS[d].fire} fires a salvo.`} If she drifts out of arc, turn to follow her.`,
    why: 'About one shell in twelve hits at this range with good gunnery. The Admiralty counts that as a good day.',
    done: (f, m) => f.hitsScored - m.hits >= 3,
  },
  {
    id: 'sight',
    title: '9. THE DIRECTOR’S SIGHT',
    focus: 'sight',
    text: (d) =>
      d === 'touch'
        ? 'Hold SIGHT to look through the director. Drag to pan, pinch to zoom.'
        : d === 'gamepad'
          ? 'Hold LT to look through the director. R3 and L3 zoom.'
          : 'Hold the right mouse button (or V) to look through the director. Move the mouse to pan and scroll to zoom.',
    why: 'From the foretop you see her hull, her smoke and the splashes better than from the deck, and you can check that she is where the plot says.',
    done: (f) => f.sightUp,
  },
  {
    id: 'ruler',
    title: '10. CHOOSE YOUR RANGE',
    focus: 'ruler',
    manual: true,
    text: (d) =>
      `Under the target card the penetration ruler shows at what range your shells get through each part of her armour: BELT (the side), UPPER and DECK. Close in, shells are fast and flat and punch through the side; far out they are slow and drop steeply, so only the upper works and the deck are open. Pick the range that suits the target. The ruler is for armour-piercing shell: ${SHELL_HOW[d]} loads high-explosive, which bursts on contact and is better against upperworks, small ships and forts, but weak against armour.`,
    why: 'Range is the decision the whole fight turns on: close in you can hurt anything, and anything can hurt you.',
    done: () => false,
  },
  {
    id: 'complete',
    title: 'GUNNERY SCHOOL COMPLETE',
    manual: true,
    focus: null,
    text: () =>
      'You have picked a target, plotted it, ranged on it, fired, spotted the fall of shot, corrected, and landed hits. In a real fight: keep moving, because shells take half a minute to arrive; choose your range by the ruler; and remember that an enemy’s casemate guns reach you at close range.',
    done: () => false,
  },
];

/**
 * The tutorial's progress: which step is on, what was so when it began, and whether the player has done it. It watches the same
 * `GunneryStatus` the HUD draws, so it needs nothing from the simulation that the player cannot see.
 */
export class Tutorial {
  private i = 0;
  private memory: StepMemory | null = null;
  private last: TutorialFrame | null = null;
  /** The last card has been reached. */
  complete = false;
  /** The player has put the last card away. */
  finished = false;
  /** The step the tutorial landed on after the target went down and the shooting steps were passed over (-1: it has not). */
  private downAt = -1;

  constructor(readonly steps: readonly TutorialStep[] = GUNNERY_SCHOOL) {}

  get index(): number {
    return this.i;
  }

  get step(): TutorialStep {
    return this.steps[this.i]!;
  }

  private begin(f: TutorialFrame): void {
    const r = f.status.lastReport;
    this.memory = {
      at: f.now,
      shells: f.shellsFired,
      hits: f.hitsScored,
      salvo: r ? r.salvo : -1,
      range: f.status.corrections.range,
      deflection: f.status.corrections.deflection,
    };
  }

  private advance(f: TutorialFrame): void {
    if (this.i >= this.steps.length - 1) return;
    this.i++;
    this.begin(f);
    if (this.i === this.steps.length - 1) this.complete = true;
  }

  /** Watch a frame of the fight; steps that the player has done are finished, in order. Returns whether the step changed. */
  update(f: TutorialFrame): boolean {
    this.last = f;
    if (this.finished) return false;
    if (!this.memory) this.begin(f);
    const from = this.i;
    // A step may already be done by the time the next begins (auto-spot already on, say): carry on through them.
    // A target that has gone down ends every step that needs her: the player cannot be asked to hit a ship on the bottom.
    for (let guard = 0; guard < this.steps.length; guard++) {
      const s = this.step;
      const gone = f.targetDown && s.needsTarget === true;
      if (s.manual || !this.memory || !(gone || s.done(f, this.memory))) break;
      this.advance(f);
      if (gone) this.downAt = this.i;
    }
    return this.i !== from;
  }

  /** Go on from a manual card, or skip a step that is taking too long. */
  next(): void {
    const f = this.last;
    if (!f || this.finished) return;
    if (this.i >= this.steps.length - 1) {
      this.finished = true;
      return;
    }
    this.advance(f);
  }

  /** Put the last card away. */
  finish(): void {
    this.finished = true;
  }

  view(f: TutorialFrame, device: InputDevice): TutorialView {
    const s = this.step;
    const waited = this.memory ? f.now - this.memory.at : 0;
    let text = s.text(device, f, this.memory);
    if (this.downAt === this.i) text = `She has gone down, so the shooting is over. ${text}`;
    if (s.needsTarget && f.status.target === null) {
      text = `She is no longer designated. ${this.steps.find((x) => x.id === 'designate')!.text(device, f, this.memory)}`;
    }
    return {
      index: this.i,
      count: this.steps.length,
      id: s.id,
      title: s.title,
      text,
      why: s.why ?? null,
      focus: s.focus,
      manual: s.manual === true,
      canSkip: !s.manual && waited >= (s.skipAfter ?? 25),
      last: this.i === this.steps.length - 1,
      finished: this.finished,
    };
  }
}
