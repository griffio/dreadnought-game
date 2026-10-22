import type { InputDevice, Intent } from './intent';
import type { InputSource } from './manager';

/** Turn the wheel this fast while a rudder key is held, in rudder-lock fractions per second. */
const HELM_KEY_RATE = 1;

type Listener = (e: any) => void;
interface Events {
  addEventListener(type: string, fn: Listener): void;
}

/**
 * Keyboard bindings. W/S (or Up/Down) step the engine telegraph, A/D (or Left/Right) turn the wheel while held,
 * X puts the rudder amidships. The rest are the fire-control keys the later milestones consume.
 */
export class KeyboardSource implements InputSource {
  readonly device: InputDevice = 'keyboard-mouse';
  private readonly held = new Set<string>();
  private telegraphSteps = 0;
  private recenter = false;
  private readonly pressed = new Set<string>();
  private tabDirection: 1 | -1 = 1;
  private fireTap = false;
  private rangeSteps = 0;
  private deflectSteps = 0;

  constructor(target: Events = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.telegraphSteps++;
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.telegraphSteps--;
      else if (e.code === 'KeyX') this.recenter = true;
      else if (e.code === 'Space') this.fireTap = true;
      else if (e.code === 'KeyQ') this.rangeSteps--;
      else if (e.code === 'KeyE') this.rangeSteps++;
      else if (e.code === 'BracketLeft') this.deflectSteps--;
      else if (e.code === 'BracketRight') this.deflectSteps++;
      if (e.code === 'Tab') {
        e.preventDefault?.();
        this.tabDirection = e.shiftKey ? -1 : 1;
      }
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  poll(out: Intent): boolean {
    let active = false;

    if (this.telegraphSteps !== 0) {
      out.telegraphStep += this.telegraphSteps;
      this.telegraphSteps = 0;
      active = true;
    }
    if (this.recenter) {
      out.helmSet = 0;
      this.recenter = false;
      active = true;
    }
    const port = this.held.has('KeyA') || this.held.has('ArrowLeft');
    const starboard = this.held.has('KeyD') || this.held.has('ArrowRight');
    if (port !== starboard) {
      out.helmRate = (starboard ? 1 : -1) * HELM_KEY_RATE;
      active = true;
    }

    const p = this.pressed;
    const edge = (code: string) => p.delete(code);
    edge('Space');
    // A tap shorter than a frame still pulls the trigger once.
    if (this.held.has('Space') || this.fireTap) {
      out.fire = true;
      active = true;
    }
    this.fireTap = false;
    if (edge('KeyB')) out.ceaseFire = active = true;
    if (edge('KeyF')) out.torpedoMode = active = true;
    if (edge('KeyC')) out.cycleCamera = active = true;
    if (edge('KeyM')) out.togglePlot = active = true;
    if (edge('KeyH')) out.toggleDamageView = active = true;
    if (edge('KeyG')) out.smoke = active = true;
    if (edge('KeyK')) out.spotter = active = true;
    if (edge('KeyP') || edge('Escape')) out.pause = active = true;
    if (edge('Tab')) {
      out.cycleTarget = this.tabDirection;
      active = true;
    }
    if (edge('KeyT')) out.autoSpot = active = true;
    if (this.rangeSteps !== 0 || this.deflectSteps !== 0) {
      out.rangeCorrect += this.rangeSteps;
      out.deflectCorrect += this.deflectSteps;
      this.rangeSteps = 0;
      this.deflectSteps = 0;
      active = true;
    }
    if (this.held.has('KeyV')) {
      out.sight = true;
      active = true;
    }
    if (edge('Digit1')) out.shell = 'ap';
    if (edge('Digit2')) out.shell = 'he';
    if (edge('Digit3')) out.shell = 'star';
    this.pressed.clear();
    return active;
  }
}
