import type { TutorialView } from '../app/tutorial';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export interface TutorialActions {
  /** Go on from a card that has nothing to do, or skip a step that is taking too long. */
  next(): void;
  /** Leave the school for the front door. */
  exit(): void;
  /** The school is done: go on to the first sortie. */
  sortie(): void;
  /** The school is done: stay and keep firing. */
  stay(): void;
}

/**
 * The coach's card: which step the player is on, what to do about it in the words of the device in hand, and why. It points at
 * the part of the HUD the step is about by setting `data-tut-focus` on the body (the stylesheet draws the pulse), and it keeps
 * out of the way of the target card, the log and the touch buttons.
 */
export class TutorialHud {
  readonly element: HTMLDivElement;
  private readonly step: HTMLDivElement;
  private readonly dots: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly why: HTMLDivElement;
  private readonly buttons: HTMLDivElement;
  private shown = '';

  constructor(root: HTMLElement, private readonly actions: TutorialActions) {
    this.element = el('div', 'tutor');
    const head = el('div', 'thead', this.element);
    this.step = el('div', 'tstep', head);
    this.dots = el('div', 'tdots', head);
    this.title = el('div', 'ttitle', this.element);
    this.text = el('div', 'ttext', this.element);
    this.why = el('div', 'twhy', this.element);
    this.buttons = el('div', 'tbtns', this.element);
    root.append(this.element);
  }

  private button(label: string, cls: string, fn: () => void): void {
    const b = el('button', `tbtn ${cls}`, this.buttons, label);
    b.type = 'button';
    b.addEventListener('click', fn);
  }

  update(v: TutorialView): void {
    this.element.hidden = v.finished;
    document.body.dataset.tutFocus = v.finished ? '' : (v.focus ?? '');
    if (v.finished) return;
    this.step.textContent = v.last ? 'DONE' : v.index === 0 ? 'INTRO' : `STEP ${v.index} OF ${v.count - 2}`;
    this.title.textContent = v.title;
    this.text.textContent = v.text;
    this.why.textContent = v.why ?? '';
    this.why.hidden = v.why === null;
    // The dots mark progress through the ten steps (the welcome and the last card are not among them).
    if (this.dots.childElementCount !== v.count) {
      this.dots.replaceChildren();
      for (let i = 0; i < v.count; i++) el('i', '', this.dots);
    }
    [...this.dots.children].forEach((d, i) => ((d as HTMLElement).dataset.state = i < v.index ? 'done' : i === v.index ? 'now' : 'todo'));
    this.element.dataset.step = v.id;
    // A card with nothing to do is a dialogue to read and dismiss: it sits in the middle, clear of the controls.
    this.element.dataset.manual = String(v.manual);

    // The buttons only change when what they offer does.
    const key = `${v.id}:${v.manual}:${v.canSkip}:${v.last}`;
    if (key === this.shown) return;
    this.shown = key;
    this.buttons.replaceChildren();
    if (v.last) {
      this.button('FIRST SORTIE', 'go', () => this.actions.sortie());
      this.button('KEEP FIRING', '', () => this.actions.stay());
      this.button('RETURN TO PORT', '', () => this.actions.exit());
      return;
    }
    if (v.manual) this.button(v.index === 0 ? 'BEGIN' : 'NEXT', 'go', () => this.actions.next());
    else if (v.canSkip) this.button('SKIP STEP', '', () => this.actions.next());
    this.button('EXIT', 'quiet', () => this.actions.exit());
  }
}
