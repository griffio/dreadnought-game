import type { InputDevice } from '../input/intent';
import { TELEGRAPH_LABELS } from '../sim/ships/dynamics';

export interface HelmReadout {
  speedKnots: number;
  headingDeg: number;
  rudderDeg: number;
  rudderOrderDeg: number;
  rudderMaxDeg: number;
  telegraph: number;
}

const HINTS: Record<InputDevice, string> = {
  'keyboard-mouse': 'W/S engines  ·  A/D helm  ·  X midships  ·  drag to orbit  ·  wheel to zoom  ·  Space salvo',
  gamepad: 'L-stick ↑↓ engines  ·  ←→ helm  ·  R-stick camera',
  touch: '',
};

/** Speed, heading, rudder and engine order as a compact instrument strip, plus per-device control hints. */
export class HelmHud {
  readonly element: HTMLDivElement;
  private readonly speed: HTMLOutputElement;
  private readonly heading: HTMLOutputElement;
  private readonly rudderText: HTMLOutputElement;
  private readonly order: HTMLOutputElement;
  private readonly rudderActual: HTMLElement;
  private readonly rudderOrder: HTMLElement;
  private readonly hints: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'instruments';
    const cell = (label: string) => {
      const c = document.createElement('div');
      c.className = 'cell';
      const l = document.createElement('label');
      l.textContent = label;
      const o = document.createElement('output');
      c.append(l, o);
      this.element.append(c);
      return { c, o };
    };
    const speed = cell('SPEED');
    const heading = cell('HEADING');
    const rudder = cell('RUDDER');
    const order = cell('ORDER');
    this.speed = speed.o;
    this.heading = heading.o;
    this.rudderText = rudder.o;
    this.order = order.o;

    const bar = document.createElement('div');
    bar.className = 'rudder-bar';
    this.rudderOrder = document.createElement('i');
    this.rudderOrder.className = 'order';
    this.rudderActual = document.createElement('i');
    this.rudderActual.className = 'actual';
    bar.append(this.rudderOrder, this.rudderActual);
    rudder.c.insertBefore(bar, rudder.o);

    this.hints = document.createElement('div');
    this.hints.className = 'hints';
    root.append(this.element, this.hints);
    this.setDevice('keyboard-mouse');
  }

  setDevice(device: InputDevice): void {
    this.hints.textContent = HINTS[device];
    this.hints.hidden = HINTS[device] === '';
  }

  update(r: HelmReadout): void {
    this.speed.textContent = `${r.speedKnots.toFixed(1)} kn`;
    this.heading.textContent = `${Math.round(r.headingDeg).toString().padStart(3, '0')}°`;
    const side = r.rudderDeg > 0.5 ? 'S' : r.rudderDeg < -0.5 ? 'P' : '';
    this.rudderText.textContent = side ? `${side} ${Math.abs(Math.round(r.rudderDeg))}°` : 'MIDSHIPS';
    this.order.textContent = TELEGRAPH_LABELS[r.telegraph] ?? '';
    const place = (el: HTMLElement, deg: number) => {
      el.style.left = `${50 + (deg / r.rudderMaxDeg) * 50}%`;
    };
    place(this.rudderActual, r.rudderDeg);
    place(this.rudderOrder, r.rudderOrderDeg);
  }
}
