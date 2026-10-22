import type { InputDevice, Intent } from '../input/intent';
import type { InputSource } from '../input/manager';
import { TELEGRAPH_LABELS, TELEGRAPH_MAX, TELEGRAPH_MIN } from '../sim/ships/dynamics';
import { angleDelta, rudderFromWheel, telegraphFromTrack, trackFromTelegraph, wheelFromRudder } from './helm-math';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Rudder fraction per second the wheel unwinds at when released with auto-centre on. */
const AUTO_CENTRE_RATE = 0.7;
const DOUBLE_TAP_MS = 380;

/** A ship's wheel and an engine-order telegraph lever for touch play. Also reflects the ship's real state. */
export class HelmWidgets implements InputSource {
  readonly device: InputDevice = 'touch';
  readonly element: HTMLDivElement;
  /** Let go of the wheel and it returns amidships (comfortable on glass). Off = it stays where you leave it. */
  autoCenter = true;

  private readonly wheel: HTMLDivElement;
  private readonly wheelSvg: SVGGElement;
  private readonly lever: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly handle: HTMLDivElement;
  private readonly labels = new Map<number, HTMLDivElement>();

  private wheelAngle = 0;
  private dragging = false;
  private returning = false;
  private lastPointerAngle = 0;
  private lastTapAt = 0;
  private helmDirty = false;
  private pendingTelegraph: number | null = null;
  private leverDragging = false;
  private shownTelegraph = 0;
  private touched = false;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'helm';

    // Telegraph lever.
    this.lever = document.createElement('div');
    this.lever.className = 'lever';
    this.track = document.createElement('div');
    this.track.className = 'track';
    for (let p = TELEGRAPH_MAX; p >= TELEGRAPH_MIN; p--) {
      const label = document.createElement('div');
      label.className = 'detent';
      label.textContent = TELEGRAPH_LABELS[p] ?? '';
      label.style.top = `${trackFromTelegraph(p) * 100}%`;
      this.track.append(label);
      this.labels.set(p, label);
    }
    this.handle = document.createElement('div');
    this.handle.className = 'handle';
    this.track.append(this.handle);
    this.lever.append(this.track);

    // Ship's wheel.
    this.wheel = document.createElement('div');
    this.wheel.className = 'wheel';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-100 -100 200 200');
    this.wheelSvg = document.createElementNS(SVG_NS, 'g');
    const ring = (r: number, w: number, cls: string) => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', String(r));
      c.setAttribute('class', cls);
      c.setAttribute('stroke-width', String(w));
      return c;
    };
    this.wheelSvg.append(ring(66, 9, 'rim'), ring(14, 0, 'hub'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spoke = document.createElementNS(SVG_NS, 'line');
      spoke.setAttribute('x1', '0');
      spoke.setAttribute('y1', '0');
      spoke.setAttribute('x2', String(Math.sin(a) * 90));
      spoke.setAttribute('y2', String(-Math.cos(a) * 90));
      spoke.setAttribute('class', 'spoke');
      this.wheelSvg.append(spoke);
      const knob = document.createElementNS(SVG_NS, 'circle');
      knob.setAttribute('cx', String(Math.sin(a) * 90));
      knob.setAttribute('cy', String(-Math.cos(a) * 90));
      knob.setAttribute('r', '7');
      knob.setAttribute('class', i === 0 ? 'knob top' : 'knob');
      this.wheelSvg.append(knob);
    }
    svg.append(this.wheelSvg);
    this.wheel.append(svg);

    this.element.append(this.lever, this.wheel);
    root.append(this.element);
    this.bindWheel();
    this.bindLever();
    this.render();
  }

  // ---- state from the ship --------------------------------------------------------------------

  /** Show the ship's actual telegraph setting (unless the player is moving the lever right now). */
  setTelegraph(position: number): void {
    if (this.leverDragging) return;
    this.shownTelegraph = position;
  }

  /** Per-frame animation: auto-centre the wheel and refresh the visuals. */
  update(dt: number): void {
    if (this.returning && !this.dragging) {
      const step = wheelFromRudder(AUTO_CENTRE_RATE) * dt;
      if (Math.abs(this.wheelAngle) <= step) {
        this.wheelAngle = 0;
        this.returning = false;
      } else {
        this.wheelAngle -= Math.sign(this.wheelAngle) * step;
      }
      this.helmDirty = true;
    }
    this.render();
  }

  // ---- input -----------------------------------------------------------------------------------

  poll(out: Intent): boolean {
    let active = this.touched || this.dragging || this.leverDragging;
    this.touched = false;
    if (this.pendingTelegraph !== null) {
      out.telegraphSet = this.pendingTelegraph;
      this.pendingTelegraph = null;
      active = true;
    }
    if (this.helmDirty) {
      out.helmSet = rudderFromWheel(this.wheelAngle);
      this.helmDirty = false;
      active = true;
    }
    return active;
  }

  private bindWheel(): void {
    const pointerAngle = (e: PointerEvent) => {
      const r = this.wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    this.wheel.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.wheel.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.returning = false;
      this.touched = true;
      this.lastPointerAngle = pointerAngle(e);
      const now = performance.now();
      if (now - this.lastTapAt < DOUBLE_TAP_MS) {
        this.wheelAngle = 0; // double tap: midships
        this.helmDirty = true;
      }
      this.lastTapAt = now;
      e.preventDefault();
    });
    this.wheel.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const a = pointerAngle(e);
      const limit = wheelFromRudder(1);
      this.wheelAngle = Math.min(Math.max(this.wheelAngle + angleDelta(this.lastPointerAngle, a), -limit), limit);
      this.lastPointerAngle = a;
      this.helmDirty = true;
      this.touched = true;
    });
    const release = () => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.autoCenter && this.wheelAngle !== 0) this.returning = true;
    };
    this.wheel.addEventListener('pointerup', release);
    this.wheel.addEventListener('pointercancel', release);
  }

  private bindLever(): void {
    const set = (e: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      const p = telegraphFromTrack(e.clientY, r.top, r.height);
      if (p !== this.shownTelegraph || this.pendingTelegraph === null) {
        this.shownTelegraph = p;
        this.pendingTelegraph = p;
      }
      this.touched = true;
    };
    this.track.addEventListener('pointerdown', (e) => {
      this.track.setPointerCapture(e.pointerId);
      this.leverDragging = true;
      set(e);
      e.preventDefault();
    });
    this.track.addEventListener('pointermove', (e) => {
      if (this.leverDragging) set(e);
    });
    const release = () => {
      this.leverDragging = false;
    };
    this.track.addEventListener('pointerup', release);
    this.track.addEventListener('pointercancel', release);
  }

  private render(): void {
    this.wheelSvg.setAttribute('transform', `rotate(${(this.wheelAngle * 180) / Math.PI})`);
    this.handle.style.top = `${trackFromTelegraph(this.shownTelegraph) * 100}%`;
    for (const [p, el] of this.labels) el.classList.toggle('active', p === this.shownTelegraph);
  }
}
