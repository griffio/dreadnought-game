import type { InputDevice, Intent } from './intent';
import type { InputSource } from './manager';

export interface GamepadLike {
  connected: boolean;
  id?: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

const DEADZONE = 0.18;
/** Stick deflection that counts as a flick for the telegraph. */
const FLICK = 0.6;
const REPEAT_DELAY = 0.5;
const REPEAT_INTERVAL = 0.3;
const ORBIT_DEG_PER_SEC = 140;
/** Trigger travel that counts as pressed. */
const TRIGGER_THRESHOLD = 0.35;

/** Standard-mapping button indices. */
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Radial dead zone that rescales so the output still reaches 1. */
export function deadzone(x: number, y: number, zone = DEADZONE): [number, number] {
  const m = Math.hypot(x, y);
  if (m < zone) return [0, 0];
  const s = (Math.min(m, 1) - zone) / (1 - zone) / m;
  return [x * s, y * s];
}

/**
 * Gamepad (Gamepad API, standard mapping). Left stick: flick up/down steps the engine telegraph (hold to repeat),
 * left/right steers (the wheel returns amidships when the stick is released). Right stick orbits the camera or, with
 * the sight up, looks around. RT fires, LT raises the director's sight (R3/L3 then zoom in and out). Buttons follow
 * the plan's table. Rumble is not used: Safari on iPad has no haptics.
 */
export class GamepadSource implements InputSource {
  readonly device: InputDevice = 'gamepad';
  private lastDir = 0;
  private held = 0;
  private helmActive = false;
  private lastTime: number | null = null;
  private readonly prev: boolean[] = [];
  /** Axes that were already at full deflection when first seen: a stuck or lying-on-its-side stick, ignored until it centres. */
  private readonly stuck: boolean[] = [];

  constructor(
    private readonly getPads: () => readonly (GamepadLike | null)[] = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []),
    private readonly now: () => number = () => performance.now(),
  ) {}

  get connected(): boolean {
    return this.getPads().some((p) => p?.connected);
  }

  poll(out: Intent): boolean {
    const pad = this.getPads().find((p) => p?.connected);
    const t = this.now();
    const dt = this.lastTime === null ? 0 : Math.min(Math.max((t - this.lastTime) / 1000, 0), 0.1);
    this.lastTime = t;
    if (!pad) return false;

    let active = false;
    const axis = (i: number) => {
      const v = pad.axes[i] ?? 0;
      let stuck = this.stuck[i];
      if (stuck === undefined) stuck = Math.abs(v) > 0.9;
      if (stuck && Math.abs(v) < 0.5) stuck = false;
      this.stuck[i] = stuck;
      return stuck ? 0 : v;
    };
    const down = (i: number) => (pad.buttons[i]?.pressed ?? false) || (pad.buttons[i]?.value ?? 0) > 0.5;
    const pressedNow = (i: number) => {
      const d = down(i);
      const edge = d && !this.prev[i];
      this.prev[i] = d;
      return edge;
    };

    const [lx, ly] = deadzone(axis(0), axis(1));
    // Telegraph: flick up = more ahead. Stick Y is negative up.
    const dir = -ly > FLICK ? 1 : -ly < -FLICK ? -1 : 0;
    if (dir !== this.lastDir) {
      if (dir !== 0) out.telegraphStep += dir;
      this.held = 0;
      this.lastDir = dir;
      if (dir !== 0) active = true;
    } else if (dir !== 0) {
      this.held += dt;
      if (this.held >= REPEAT_DELAY) {
        out.telegraphStep += dir;
        this.held -= REPEAT_INTERVAL;
      }
      active = true;
    }

    // Rudder: proportional with a squared response for fine control near the middle.
    if (lx !== 0) {
      out.helmSet = Math.sign(lx) * lx * lx;
      this.helmActive = true;
      active = true;
    } else if (this.helmActive) {
      out.helmSet = 0;
      this.helmActive = false;
    }

    const lt = pad.buttons[BTN.LT]?.value ?? 0;
    const rt = pad.buttons[BTN.RT]?.value ?? 0;
    const sighting = lt > TRIGGER_THRESHOLD;

    // Right stick: orbits the chase camera; with the sight up it looks around (left/right reversed, as a dragged finger
    // would move the view, which is how the sight camera reads orbit input).
    const [rx, ry] = deadzone(axis(2), axis(3));
    if (rx !== 0 || ry !== 0) {
      const sx = sighting ? -1 : 1;
      out.cameraOrbit = [out.cameraOrbit[0] + sx * rx * ORBIT_DEG_PER_SEC * dt, out.cameraOrbit[1] - ry * ORBIT_DEG_PER_SEC * dt];
      active = true;
    }
    if (sighting) {
      out.sight = true;
      active = true;
    }
    if (rt > TRIGGER_THRESHOLD) {
      out.fire = true;
      active = true;
    }

    if (pressedNow(BTN.START)) out.pause = active = true;
    if (pressedNow(BTN.SELECT)) out.togglePlot = active = true;
    // The stick clicks zoom the sight; with it down they do their ordinary jobs.
    const r3 = pressedNow(BTN.R3);
    const l3 = pressedNow(BTN.L3);
    if (sighting) {
      if (r3) out.cameraZoom += 1;
      if (l3) out.cameraZoom -= 1;
    } else if (r3) {
      out.cycleCamera = true;
    }
    if (r3 || l3) active = true;
    if (pressedNow(BTN.Y)) out.toggleDamageView = active = true;
    if (pressedNow(BTN.B)) out.ceaseFire = active = true;
    if (pressedNow(BTN.X)) out.torpedoMode = active = true;
    if (pressedNow(BTN.A)) out.autoSpot = active = true;
    // Pressing in the left stick (with the sight down) sends the spotter aircraft up or brings it home.
    if (!sighting && l3) out.spotter = active = true;
    if (pressedNow(BTN.LB)) out.cycleTarget = -1;
    if (pressedNow(BTN.RB)) out.cycleTarget = 1;
    if (pressedNow(BTN.UP)) out.rangeCorrect += 1;
    if (pressedNow(BTN.DOWN)) out.rangeCorrect -= 1;
    if (pressedNow(BTN.LEFT)) out.deflectCorrect -= 1;
    if (pressedNow(BTN.RIGHT)) out.deflectCorrect += 1;
    if (out.cycleTarget !== 0 || out.rangeCorrect !== 0 || out.deflectCorrect !== 0) active = true;
    return active;
  }
}
