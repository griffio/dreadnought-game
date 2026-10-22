import type { InputDevice, Intent } from '../input/intent';
import type { InputSource } from '../input/manager';
import type { GunneryStatus } from '../sim/gunnery/gunnery';

/**
 * Touch controls for the guns: a big FIRE ring that fills as the battery comes ready, range and deflection steppers for
 * the spotting corrections, the director's sight, auto-spot, target cycling and cease fire. Visible only when a finger
 * was the last thing used. Tapping a ship on the screen designates it (the canvas handles that).
 */
export class GunneryWidgets implements InputSource {
  readonly device: InputDevice = 'touch';
  readonly element: HTMLDivElement;
  private readonly fire: HTMLButtonElement;
  private readonly sight: HTMLButtonElement;
  private readonly auto: HTMLButtonElement;
  private readonly tubes: HTMLButtonElement;
  private readonly spotterBtn: HTMLButtonElement;
  private readonly shellBtn: HTMLButtonElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly fireLabel: HTMLElement;
  private readonly autoLabel: HTMLElement;
  private readonly deflLabels: HTMLElement[];

  private fireHeld = false;
  private fireTapped = false;
  private sightOn = false;
  private rangeSteps = 0;
  private deflectSteps = 0;
  private cycle: 0 | 1 = 0;
  private cease = false;
  private autoToggle = false;
  private damageToggle = false;
  private tubesToggle = false;
  private spotterToggle = false;
  private shellToggle = false;
  private camToggle = false;
  private replayPress = false;
  private plotToggle = false;
  private touched = false;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'gtouch';

    this.fire = this.button('FIRE', 'fire');
    this.sight = this.button('SIGHT', 'sight');
    this.auto = this.button('AUTO SPOT', 'auto');
    const cease = this.button('CEASE', 'cease');
    const next = this.button('TARGET', 'next');
    const damage = this.button('DAMAGE', 'damage');
    this.tubes = this.button('TORPEDO', 'tubes');
    this.spotterBtn = this.button('SPOTTER', 'spotter');
    this.shellBtn = this.button('SHELL AP', 'shell');
    this.camBtn = this.button('SHELL CAM', 'shellcam');
    this.replayBtn = this.button('REPLAY', 'replaybtn');
    const plot = this.button('PLOT', 'plot');
    const rangeUp = this.button('RANGE +', 'step');
    const rangeDown = this.button('RANGE -', 'step');
    const deflR = this.button('DEFL R', 'step');
    const deflL = this.button('DEFL L', 'step');
    const steppers = document.createElement('div');
    steppers.className = 'steppers';
    steppers.append(rangeUp, rangeDown, deflL, deflR);
    this.element.append(this.fire, this.sight, cease, this.auto, next, damage, this.tubes, this.spotterBtn, this.shellBtn, this.camBtn, this.replayBtn, plot, steppers);
    this.fireLabel = this.fire.querySelector('span')!;
    this.autoLabel = this.auto.querySelector('span')!;
    this.deflLabels = [deflL.querySelector('span')!, deflR.querySelector('span')!];
    root.append(this.element);

    // The fire ring is a trigger: held means keep firing. Everything else acts on press.
    this.fire.addEventListener('pointerdown', (e) => {
      this.fire.setPointerCapture(e.pointerId);
      this.fireHeld = true;
      this.fireTapped = true;
      this.touched = true;
      e.preventDefault();
    });
    const release = () => {
      this.fireHeld = false;
    };
    this.fire.addEventListener('pointerup', release);
    this.fire.addEventListener('pointercancel', release);

    this.press(this.sight, () => (this.sightOn = !this.sightOn));
    this.press(cease, () => (this.cease = true));
    this.press(this.auto, () => (this.autoToggle = true));
    this.press(next, () => (this.cycle = 1));
    this.press(damage, () => (this.damageToggle = true));
    this.press(this.tubes, () => (this.tubesToggle = true));
    this.press(this.spotterBtn, () => (this.spotterToggle = true));
    this.press(this.shellBtn, () => (this.shellToggle = true));
    this.press(this.camBtn, () => (this.camToggle = true));
    this.press(this.replayBtn, () => (this.replayPress = true));
    this.press(plot, () => (this.plotToggle = true));
    this.press(rangeUp, () => this.rangeSteps++);
    this.press(rangeDown, () => this.rangeSteps--);
    this.press(deflR, () => this.deflectSteps++);
    this.press(deflL, () => this.deflectSteps--);
  }

  private button(label: string, cls: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `gbtn ${cls}`;
    const text = document.createElement('span');
    text.textContent = label;
    b.append(text);
    return b;
  }

  private press(b: HTMLButtonElement, fn: () => void): void {
    b.addEventListener('pointerdown', (e) => {
      this.touched = true;
      fn();
      e.preventDefault();
    });
  }

  poll(out: Intent): boolean {
    let active = this.touched || this.fireHeld;
    this.touched = false;
    // A tap shorter than a frame still pulls the trigger once.
    if (this.fireHeld || this.fireTapped) out.fire = true;
    this.fireTapped = false;
    if (this.sightOn) out.sight = true;
    if (this.cease) {
      out.ceaseFire = true;
      this.cease = false;
      this.fireHeld = false;
    }
    if (this.autoToggle) {
      out.autoSpot = true;
      this.autoToggle = false;
    }
    if (this.damageToggle) {
      out.toggleDamageView = true;
      this.damageToggle = false;
    }
    if (this.tubesToggle) {
      out.torpedoMode = true;
      this.tubesToggle = false;
    }
    if (this.spotterToggle) {
      out.spotter = true;
      this.spotterToggle = false;
    }
    if (this.plotToggle) {
      out.togglePlot = true;
      this.plotToggle = false;
    }
    if (this.shellToggle) {
      out.cycleShell = true;
      this.shellToggle = false;
    }
    if (this.camToggle) {
      out.cycleCamera = true;
      this.camToggle = false;
    }
    if (this.replayPress) {
      out.replay = true;
      this.replayPress = false;
    }
    if (this.cycle !== 0) {
      out.cycleTarget = 1;
      this.cycle = 0;
    }
    if (this.rangeSteps !== 0) {
      out.rangeCorrect += this.rangeSteps;
      this.rangeSteps = 0;
      active = true;
    }
    if (this.deflectSteps !== 0) {
      out.deflectCorrect += this.deflectSteps;
      this.deflectSteps = 0;
      active = true;
    }
    return active;
  }

  /** The shell camera is on (each salvo is followed to its splash). */
  setShellCam(on: boolean): void {
    this.camBtn.dataset.on = on ? '1' : '0';
  }

  /** Reflect the battery's state: the ring fills as turrets come ready, and toggles show their state. */
  update(s: GunneryStatus, torpedoMode = false, spotter: { label: string; on: boolean } | null = null): void {
    this.spotterBtn.hidden = spotter === null;
    if (spotter) {
      this.spotterBtn.dataset.on = spotter.on ? '1' : '0';
      this.spotterBtn.querySelector('span')!.textContent = spotter.label;
    }
    // The shell button names the round loaded, in the colour its tracers glow; with the tubes in hand there is no choice to make.
    this.shellBtn.hidden = !s.shellChoice || torpedoMode;
    this.shellBtn.dataset.kind = s.shell;
    this.shellBtn.querySelector('span')!.textContent = s.shell === 'he' ? 'SHELL HE' : 'SHELL AP';
    // With the tubes in hand the same controls fire the torpedoes, set the fan and swap the run speed.
    this.fireLabel.textContent = torpedoMode ? 'LAUNCH' : 'FIRE';
    this.autoLabel.textContent = torpedoMode ? 'RUN SPEED' : 'AUTO SPOT';
    this.deflLabels[0]!.textContent = torpedoMode ? 'FAN -' : 'DEFL L';
    this.deflLabels[1]!.textContent = torpedoMode ? 'FAN +' : 'DEFL R';
    this.tubes.dataset.on = torpedoMode ? '1' : '0';
    const bearing = s.turrets.filter((t) => t.bears);
    const ready = bearing.filter((t) => t.loaded >= 1 && t.aligned).length;
    const fill = bearing.length === 0 ? 0 : bearing.reduce((a, t) => a + (t.aligned ? t.loaded : t.loaded * 0.6), 0) / bearing.length;
    this.fire.style.setProperty('--fill', `${Math.round(fill * 100)}%`);
    this.fire.dataset.ready = ready > 0 && ready === bearing.length ? '1' : '0';
    this.fire.dataset.armed = s.armed ? '1' : '0';
    this.sight.dataset.on = this.sightOn ? '1' : '0';
    this.auto.dataset.on = s.autoSpot ? '1' : '0';
  }
}
