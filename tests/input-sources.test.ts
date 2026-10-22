import { describe, expect, it } from 'vitest';
import { deadzone, GamepadSource, type GamepadLike } from '../src/input/gamepad';
import { createIntent, clearEdges, resetLevels } from '../src/input/intent';
import { KeyboardSource } from '../src/input/keyboard-mouse';
import { InputManager } from '../src/input/manager';
import { PointerCameraSource } from '../src/input/pointer-camera';
import {
  angleDelta,
  rudderFromWheel,
  telegraphFromTrack,
  trackFromTelegraph,
  wheelFromRudder,
} from '../src/ui/helm-math';

/** A minimal event target for Node: the sources only call addEventListener and read plain event fields. */
function fakeTarget() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, ...event });
    },
  };
}

describe('KeyboardSource', () => {
  it('W/S step the telegraph, and several presses in a frame accumulate', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    t.fire('keydown', { code: 'KeyW' });
    t.fire('keydown', { code: 'KeyW' });
    t.fire('keydown', { code: 'KeyS' });
    expect(src.poll(out)).toBe(true);
    expect(out.telegraphStep).toBe(1);
    clearEdges(out);
    expect(src.poll(out)).toBe(false);
    expect(out.telegraphStep).toBe(0);
  });

  it('ignores key auto-repeat so holding W does not run the telegraph away', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    t.fire('keydown', { code: 'KeyW' });
    for (let i = 0; i < 5; i++) t.fire('keydown', { code: 'KeyW', repeat: true });
    src.poll(out);
    expect(out.telegraphStep).toBe(1);
  });

  it('A/D turn the wheel while held, and stop when released', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    t.fire('keydown', { code: 'KeyD' });
    expect(src.poll(out)).toBe(true);
    expect(out.helmRate).toBe(1);
    t.fire('keyup', { code: 'KeyD' });
    resetLevels(out);
    expect(src.poll(out)).toBe(false);
    expect(out.helmRate).toBe(0);
    t.fire('keydown', { code: 'ArrowLeft' });
    src.poll(out);
    expect(out.helmRate).toBe(-1);
  });

  it('holding both A and D cancels out', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    t.fire('keydown', { code: 'KeyA' });
    t.fire('keydown', { code: 'KeyD' });
    src.poll(out);
    expect(out.helmRate).toBe(0);
  });

  it('X puts the rudder amidships', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    t.fire('keydown', { code: 'KeyX' });
    src.poll(out);
    expect(out.helmSet).toBe(0);
  });

  it('does not clobber another device\'s held fire state when idle', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    out.fire = true; // pretend a gamepad is holding the trigger
    src.poll(out);
    expect(out.fire).toBe(true);
  });
});

function pad(partial: Partial<{ axes: number[]; pressed: number[]; values: Record<number, number> }> = {}): GamepadLike {
  const axes = partial.axes ?? [0, 0, 0, 0];
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: (partial.pressed ?? []).includes(i),
    value: partial.values?.[i] ?? ((partial.pressed ?? []).includes(i) ? 1 : 0),
  }));
  return { connected: true, axes, buttons };
}

function gamepadSource() {
  let current: GamepadLike | null = pad();
  let clock = 0;
  const src = new GamepadSource(() => [current], () => clock);
  return {
    src,
    set: (p: GamepadLike | null) => (current = p),
    advance: (ms: number) => (clock += ms),
  };
}

describe('deadzone', () => {
  it('zeroes small deflections and rescales so full deflection still reaches 1', () => {
    expect(deadzone(0.1, 0.1)).toEqual([0, 0]);
    const [x, y] = deadzone(1, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBe(0);
    const [hx] = deadzone(0.59, 0);
    expect(hx).toBeGreaterThan(0.4);
    expect(hx).toBeLessThan(0.6);
  });
});

describe('GamepadSource', () => {
  it('reports no activity with nothing connected', () => {
    const g = gamepadSource();
    g.set(null);
    expect(g.src.poll(createIntent())).toBe(false);
  });

  it('flicking the left stick up steps the telegraph once, then repeats only after a hold', () => {
    const g = gamepadSource();
    const out = createIntent();
    g.src.poll(out); // establish the clock
    g.set(pad({ axes: [0, -1, 0, 0] }));
    const stepsOver = (ms: number) => {
      let steps = 0;
      for (let t = 0; t < ms; t += 16) {
        g.advance(16);
        const frame = createIntent();
        g.src.poll(frame);
        steps += frame.telegraphStep;
      }
      return steps;
    };
    expect(stepsOver(16)).toBe(1); // the flick itself
    expect(stepsOver(400)).toBe(0); // still inside the 0.5 s repeat delay
    expect(stepsOver(250)).toBe(1); // the hold has passed the delay: one repeat
    expect(stepsOver(1000)).toBeGreaterThanOrEqual(2); // then every ~0.3 s

    // Release, then flick down: one step the other way.
    g.set(pad());
    stepsOver(32);
    g.set(pad({ axes: [0, 1, 0, 0] }));
    expect(stepsOver(16)).toBe(-1);
  });

  it('left stick X steers proportionally with a soft centre, and returns the rudder amidships on release', () => {
    const g = gamepadSource();
    const out = createIntent();
    g.src.poll(out);
    g.set(pad({ axes: [1, 0, 0, 0] }));
    g.advance(16);
    g.src.poll(out);
    expect(out.helmSet).toBeCloseTo(1, 6);
    clearEdges(out);
    g.set(pad({ axes: [0.5, 0, 0, 0] }));
    g.advance(16);
    g.src.poll(out);
    expect(out.helmSet!).toBeGreaterThan(0);
    expect(out.helmSet!).toBeLessThan(0.25); // squared response
    clearEdges(out);
    g.set(pad());
    g.advance(16);
    g.src.poll(out);
    expect(out.helmSet).toBe(0);
    clearEdges(out);
    g.advance(16);
    g.src.poll(out);
    expect(out.helmSet).toBeNull(); // does not keep overriding other devices
  });

  it('right stick orbits the camera at a rate independent of frame rate', () => {
    const g = gamepadSource();
    const out = createIntent();
    g.src.poll(out);
    g.set(pad({ axes: [0, 0, 1, 0] }));
    let total = 0;
    for (let i = 0; i < 60; i++) {
      g.advance(1000 / 60);
      const frame = createIntent();
      g.src.poll(frame);
      total += frame.cameraOrbit[0];
    }
    expect(total).toBeGreaterThan(130);
    expect(total).toBeLessThan(150); // about 140 deg/s for one second
  });

  it('ignores an axis that is already at full deflection when first seen, until it centres', () => {
    const pad: GamepadLike = { connected: true, axes: [0, 1, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    let t = 0;
    const src = new GamepadSource(() => [pad], () => t);
    const out = createIntent();
    for (let i = 0; i < 40; i++) {
      t += 100;
      expect(src.poll(out)).toBe(false);
    }
    expect(out.telegraphStep).toBe(0);
    // The stick comes back to the middle and is then used normally.
    (pad.axes as number[])[1] = 0;
    t += 100;
    src.poll(out);
    (pad.axes as number[])[1] = -1;
    t += 100;
    expect(src.poll(out)).toBe(true);
    expect(out.telegraphStep).toBe(1);
  });

  it('button presses are edges: held does not repeat', () => {
    const g = gamepadSource();
    const out = createIntent();
    g.src.poll(out);
    g.set(pad({ pressed: [9] }));
    g.advance(16);
    g.src.poll(out);
    expect(out.pause).toBe(true);
    clearEdges(out);
    g.advance(16);
    g.src.poll(out);
    expect(out.pause).toBe(false);
  });
});

describe('PointerCameraSource', () => {
  const down = (t: ReturnType<typeof fakeTarget>, id: number, x: number, y: number, type = 'mouse') =>
    t.fire('pointerdown', { pointerId: id, pointerType: type, clientX: x, clientY: y });
  const move = (t: ReturnType<typeof fakeTarget>, id: number, x: number, y: number) =>
    t.fire('pointermove', { pointerId: id, clientX: x, clientY: y });

  it('dragging orbits the camera', () => {
    const t = fakeTarget();
    const src = new PointerCameraSource('keyboard-mouse', 'mouse', t);
    const out = createIntent();
    down(t, 1, 100, 100);
    move(t, 1, 150, 90);
    expect(src.poll(out)).toBe(true);
    expect(out.cameraOrbit[0]).toBeGreaterThan(5);
    expect(out.cameraOrbit[1]).toBeLessThan(0);
    clearEdges(out);
    expect(src.poll(out)).toBe(false);
  });

  it('ignores the other pointer type', () => {
    const t = fakeTarget();
    const mouse = new PointerCameraSource('keyboard-mouse', 'mouse', t);
    const out = createIntent();
    down(t, 1, 100, 100, 'touch');
    move(t, 1, 200, 100);
    expect(mouse.poll(out)).toBe(false);
  });

  it('pinching zooms in notches, and spreading fingers zooms in', () => {
    const t = fakeTarget();
    const src = new PointerCameraSource('touch', 'touch', t);
    const out = createIntent();
    down(t, 1, 100, 200, 'touch');
    down(t, 2, 200, 200, 'touch');
    move(t, 2, 320, 200); // fingers 120 px further apart
    expect(src.poll(out)).toBe(true);
    expect(out.cameraZoom).toBeGreaterThanOrEqual(2);
  });

  it('mouse wheel zooms, only for the mouse source', () => {
    const t = fakeTarget();
    const mouse = new PointerCameraSource('keyboard-mouse', 'mouse', t);
    const out = createIntent();
    t.fire('wheel', { deltaY: -180 });
    expect(mouse.poll(out)).toBe(true);
    expect(out.cameraZoom).toBe(2);
  });
});

describe('InputManager with real sources', () => {
  it('the most recently active device wins, and an idle device does not steal the title', () => {
    const t = fakeTarget();
    const keyboard = new KeyboardSource(t);
    const g = gamepadSource();
    const manager = new InputManager([keyboard, g.src]);
    g.src.poll(createIntent());
    t.fire('keydown', { code: 'KeyW' });
    manager.update();
    expect(manager.activeDevice).toBe('keyboard-mouse');
    g.set(pad({ axes: [0, -1, 0, 0] }));
    g.advance(16);
    manager.update();
    expect(manager.activeDevice).toBe('gamepad');
    g.set(pad());
    manager.update();
    expect(manager.activeDevice).toBe('gamepad');
  });
});

describe('helm widget geometry', () => {
  it('angleDelta takes the short way round the wrap', () => {
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6.0, 6);
    expect(angleDelta(-3.0, 3.0)).toBeCloseTo(6.0 - 2 * Math.PI, 6);
    expect(angleDelta(0.2, 0.5)).toBeCloseTo(0.3, 6);
  });

  it('the wheel maps to rudder and back, saturating at hard over', () => {
    expect(rudderFromWheel(0)).toBe(0);
    expect(rudderFromWheel(wheelFromRudder(0.5))).toBeCloseTo(0.5, 9);
    expect(rudderFromWheel(100)).toBe(1);
    expect(rudderFromWheel(-100)).toBe(-1);
    expect(rudderFromWheel(wheelFromRudder(1))).toBeCloseTo(1, 9);
  });

  it('the lever track maps top to FLANK and bottom to FULL ASTERN, snapping to detents', () => {
    expect(telegraphFromTrack(100, 100, 700)).toBe(4);
    expect(telegraphFromTrack(800, 100, 700)).toBe(-3);
    expect(telegraphFromTrack(-50, 100, 700)).toBe(4); // clamps
    expect(telegraphFromTrack(9999, 100, 700)).toBe(-3);
    expect(telegraphFromTrack(450, 100, 700)).toBe(0); // middle region is STOP / SLOW
    for (let p = -3; p <= 4; p++) {
      expect(telegraphFromTrack(100 + trackFromTelegraph(p) * 700, 100, 700)).toBe(p);
    }
  });
});
