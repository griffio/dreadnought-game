import { REPLAY_CAMERA_MODES, type ReplayCameraMode } from '../app/shell-camera';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export interface ReplayActions {
  toggle(): void;
  speed(v: number): void;
  camera(mode: ReplayCameraMode): void;
  /** Go to a moment of the recording, seconds since its start. */
  seek(seconds: number): void;
  restart(): void;
  exit(): void;
}

export interface ReplayState {
  /** Seconds since the start of what was recorded, and how much there is. */
  at: number;
  span: number;
  playing: boolean;
  speed: number;
  camera: ReplayCameraMode;
}

const SPEEDS = [0.25, 0.5, 1, 2] as const;
const CAMERA_LABEL: Record<ReplayCameraMode, string> = { auto: 'AUTO', ship: 'SHIP', target: 'TARGET' };

const clock = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

/**
 * The replay's controls: a bar across the bottom with the scrub line, play and pause, the speed, the camera and the way out. It is
 * shown only while a replay runs, when it is the only thing on the screen but the picture. It only asks: the replay is driven by the
 * actions it is given. Space, the arrow keys and Escape do the same for a keyboard.
 */
export class ReplayHud {
  readonly element: HTMLDivElement;
  private readonly time: HTMLElement;
  private readonly scrub: HTMLInputElement;
  private readonly play: HTMLButtonElement;
  private readonly speeds: HTMLButtonElement[] = [];
  private readonly cameras: HTMLButtonElement[] = [];
  private dragging = false;
  private span = 0;
  private at = 0;
  private shown = false;

  constructor(root: HTMLElement, private readonly actions: ReplayActions) {
    this.element = el('div', 'replay');
    const top = el('div', 'rptop', this.element);
    el('b', 'rpbadge', top, 'REPLAY');
    this.time = el('span', 'rptime', top);

    const bar = el('div', 'rpbar', this.element);
    this.scrub = el('input', 'rpscrub', bar);
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.max = '1';
    this.scrub.step = '0.05';
    this.scrub.addEventListener('pointerdown', () => (this.dragging = true));
    this.scrub.addEventListener('pointerup', () => (this.dragging = false));
    this.scrub.addEventListener('pointercancel', () => (this.dragging = false));
    this.scrub.addEventListener('input', () => this.actions.seek(Number(this.scrub.value)));

    const row = el('div', 'rprow', bar);
    const restart = el('button', 'rpbtn', row, 'RESTART');
    restart.addEventListener('click', () => this.actions.restart());
    this.play = el('button', 'rpbtn rpplay', row, 'PAUSE');
    this.play.addEventListener('click', () => this.actions.toggle());

    const speed = el('div', 'rpgroup', row);
    el('label', '', speed, 'SPEED');
    for (const v of SPEEDS) {
      const b = el('button', 'rpbtn', speed, v === 1 ? '1×' : v < 1 ? `${v}×`.replace('0.', '.') : `${v}×`);
      b.dataset.speed = String(v);
      b.addEventListener('click', () => this.actions.speed(v));
      this.speeds.push(b);
    }
    const cam = el('div', 'rpgroup', row);
    el('label', '', cam, 'CAMERA');
    for (const m of REPLAY_CAMERA_MODES) {
      const b = el('button', 'rpbtn', cam, CAMERA_LABEL[m]);
      b.dataset.camera = m;
      b.addEventListener('click', () => this.actions.camera(m));
      this.cameras.push(b);
    }
    const exit = el('button', 'rpbtn rpexit', row, 'EXIT');
    exit.addEventListener('click', () => this.actions.exit());

    this.element.hidden = true;
    root.append(this.element);
    window.addEventListener('keydown', (e) => this.key(e));
  }

  private key(e: KeyboardEvent): void {
    if (!this.shown) return;
    if (e.code === 'Escape' || e.code === 'KeyR') this.actions.exit();
    else if (e.code === 'Space') this.actions.toggle();
    else if (e.code === 'ArrowLeft') this.actions.seek(Math.max(this.at - 5, 0));
    else if (e.code === 'ArrowRight') this.actions.seek(Math.min(this.at + 5, this.span));
    else return;
    e.preventDefault();
  }

  show(on: boolean): void {
    this.shown = on;
    this.element.hidden = !on;
  }

  update(s: ReplayState): void {
    this.span = s.span;
    this.at = s.at;
    this.time.textContent = `${clock(s.at)} / ${clock(s.span)}`;
    this.scrub.max = String(s.span);
    if (!this.dragging) this.scrub.value = String(s.at);
    this.play.textContent = s.playing ? 'PAUSE' : s.at >= s.span - 0.05 ? 'AGAIN' : 'PLAY';
    for (const b of this.speeds) b.dataset.on = Number(b.dataset.speed) === s.speed ? '1' : '0';
    for (const b of this.cameras) b.dataset.on = b.dataset.camera === s.camera ? '1' : '0';
  }
}
