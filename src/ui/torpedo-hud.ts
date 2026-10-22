import type { InputDevice } from '../input/intent';
import type { TorpedoStatus } from '../app/game';
import type { Camera } from '../render/camera';

const DEG = 180 / Math.PI;
const bearing3 = (deg: number): string => Math.round((deg + 360) % 360).toString().padStart(3, '0');

const HINTS: Record<InputDevice, string> = {
  'keyboard-mouse': 'F guns/torpedoes  ·  Space launch  ·  [ ] widen / close the fan  ·  T run speed  ·  Tab next target  ·  turn the ship to bring the tubes to bear',
  gamepad: 'X guns/torpedoes  ·  RT launch  ·  D-pad left/right fan  ·  A run speed  ·  LB/RB target',
  touch: '',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export interface TorpedoHudInput {
  status: TorpedoStatus | null;
  /** The designated target's plotted position is wanted for the lead marker; the camera projects it. */
  camera: Camera;
  width: number;
  height: number;
}

/**
 * The torpedo officer's card, shown while the tubes are the weapon in hand: the course the fan must run on, how far and how
 * long, which tubes bear, and what to do about it if they do not. A marker on the sea shows where the meeting is expected.
 */
export class TorpedoHud {
  readonly element: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private readonly plot: HTMLDivElement;
  private readonly launch: HTMLOutputElement;
  private readonly run: HTMLOutputElement;
  private readonly setting: HTMLOutputElement;
  private readonly fan: HTMLOutputElement;
  private readonly tubes: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private readonly hints: HTMLDivElement;
  private readonly mark: HTMLDivElement;
  private readonly tubeEls = new Map<string, HTMLDivElement>();
  private readonly tmp: [number, number] = [0, 0];

  constructor(root: HTMLElement) {
    this.element = el('div', 'torpedo');
    this.card = el('div', 'tcard', this.element);
    const head = el('div', 'thead', this.card);
    el('div', 'tname', head, 'TORPEDOES');
    this.target = el('div', 'ttarget', head);
    this.plot = el('div', 'tplot', head);
    const grid = el('div', 'tgrid', this.card);
    const cell = (label: string) => {
      const c = el('div', 'gcell', grid);
      el('label', '', c, label);
      return el('output', '', c);
    };
    this.launch = cell('LAUNCH ON');
    this.run = cell('RUN');
    this.setting = cell('RUN SPEED');
    this.fan = cell('FAN');
    this.tubes = el('div', 'ttubes', this.card);
    this.line = el('div', 'tline', this.card);
    this.mark = el('div', 'tmark', this.element);
    el('i', '', this.mark);
    el('span', '', this.mark, 'LEAD');
    this.hints = el('div', 'ghints thints', this.element);
    this.element.hidden = true;
    root.append(this.element);
    this.setDevice('keyboard-mouse');
  }

  setDevice(device: InputDevice): void {
    this.hints.textContent = HINTS[device];
    this.hints.hidden = HINTS[device] === '';
  }

  update({ status, camera, width, height }: TorpedoHudInput): void {
    const on = status !== null && status.mode;
    this.element.hidden = !on;
    document.body.dataset.torpedo = on ? '1' : '0';
    if (!status || !on) return;

    const sol = status.solution;
    this.target.textContent = sol ? sol.target.toUpperCase() : 'NO TARGET - CLICK A SHIP';
    this.plot.textContent = sol ? (sol.rough ? 'ROUGH PLOT' : 'PLOT GOOD') : '';
    this.plot.dataset.q = sol ? (sol.rough ? 'settling' : 'settled') : 'none';
    if (sol) {
      const rel = sol.relative * DEG;
      this.launch.textContent = `${bearing3(sol.heading * DEG)}  ${rel >= 0 ? 'STBD' : 'PORT'} ${Math.abs(Math.round(rel))}°`;
      const secs = Math.round(sol.time);
      this.run.textContent = `${(sol.run / 1000).toFixed(1)} km ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    } else {
      this.launch.textContent = '-';
      this.run.textContent = '-';
    }
    this.setting.textContent = `${status.setting.name} ${Math.round(status.setting.speed / 0.514444)} kn`;
    const loaded = status.tubes.filter((t) => t.enabled && t.loaded).length;
    this.fan.textContent = `${status.spreadDeg.toFixed(0)}°`;

    for (const t of status.tubes) {
      let chip = this.tubeEls.get(t.id);
      if (!chip) {
        chip = el('div', 'ttube', this.tubes);
        el('b', '', chip, t.id);
        el('span', '', chip);
        this.tubeEls.set(t.id, chip);
      }
      const text = !t.enabled ? 'OUT' : t.loaded ? (t.bears ? 'BEARS' : 'READY') : t.spare > 0 ? `${Math.ceil(t.reload)} s` : 'EMPTY';
      chip.dataset.state = !t.enabled ? 'out' : t.loaded ? (t.bears ? 'bears' : 'ready') : t.spare > 0 ? 'reload' : 'empty';
      chip.lastElementChild!.textContent = text;
    }

    let text: string;
    let tone: string;
    if (!sol) {
      text = 'NO FIRING SOLUTION - DESIGNATE A TARGET AND LET THE PLOT SETTLE';
      tone = 'blind';
    } else if (loaded === 0) {
      text = status.remaining > 0 ? 'TUBES EMPTY - RELOADING' : 'NO TORPEDOES LEFT';
      tone = 'blind';
    } else if (!sol.inReach) {
      text = `BEYOND THE RUN - NEEDS ${(sol.run / 1000).toFixed(1)} KM, ${status.setting.name} GOES ${(status.setting.range / 1000).toFixed(1)}. TRY ${status.setting.name === 'FAST' ? 'SLOW' : 'CLOSING'}`;
      tone = 'blind';
    } else if (sol.bearing === 0) {
      const turn = sol.turn * DEG;
      text = `TUBES DO NOT BEAR - TURN ${Math.abs(Math.round(turn))}° TO ${turn >= 0 ? 'STARBOARD' : 'PORT'}`;
      tone = 'wait';
    } else {
      text = `${sol.bearing} OF ${sol.loaded} TUBES BEAR - LAUNCH!`;
      tone = 'go';
    }
    if (status.running > 0) text += `   ${status.running} RUNNING`;
    this.line.textContent = text;
    this.line.dataset.tone = tone;

    // Where the meeting is expected.
    let shown = false;
    if (sol && camera.project(sol.aimX, 0, sol.aimZ, this.tmp) && Math.abs(this.tmp[0]) < 1.05 && Math.abs(this.tmp[1]) < 1.05) {
      this.mark.style.transform = `translate(${((this.tmp[0] + 1) / 2) * width}px, ${((1 - this.tmp[1]) / 2) * height}px)`;
      this.mark.dataset.bears = sol.bearing > 0 && sol.inReach ? '1' : '0';
      shown = true;
    }
    this.mark.hidden = !shown;
  }
}
