import { describe, expect, it } from 'vitest';
import { clearEdges, createIntent, type InputDevice, type Intent } from '../src/input/intent';
import { InputManager, type InputSource } from '../src/input/manager';

function fakeSource(device: InputDevice, apply: (out: Intent) => boolean): InputSource {
  return { device, poll: apply };
}

describe('InputManager', () => {
  it('merges devices into one intent', () => {
    const keyboard = fakeSource('keyboard-mouse', (out) => {
      out.helmRate = 1;
      return true;
    });
    const pad = fakeSource('gamepad', () => false);
    const manager = new InputManager([keyboard, pad]);
    expect(manager.update().helmRate).toBe(1);
  });

  it('tracks the last-used device and notifies on change only', () => {
    let padActive = false;
    const keyboard = fakeSource('keyboard-mouse', () => false);
    const pad = fakeSource('gamepad', () => padActive);
    const manager = new InputManager([keyboard, pad]);
    const seen: InputDevice[] = [];
    manager.onDeviceChange((d) => seen.push(d));

    manager.update();
    expect(manager.activeDevice).toBe('keyboard-mouse');
    expect(seen).toEqual([]);

    padActive = true;
    manager.update();
    manager.update();
    expect(manager.activeDevice).toBe('gamepad');
    expect(seen).toEqual(['gamepad']);
  });

  it('keeps level state across frames but clears edge events', () => {
    const manager = new InputManager([]);
    const intent = manager.intent;
    intent.fire = true;
    intent.rangeCorrect = 1;
    intent.shell = 'he';
    intent.cycleTarget = -1;
    manager.endFrame();
    expect(intent.fire).toBe(true);
    expect(intent.rangeCorrect).toBe(0);
    expect(intent.shell).toBeNull();
    expect(intent.cycleTarget).toBe(0);
  });
});

describe('createIntent / clearEdges', () => {
  it('starts neutral', () => {
    const i = createIntent();
    expect(i.fire).toBe(false);
    expect(i.helmSet).toBeNull();
    expect(i.aimNdc).toBeNull();
    expect(i.aimRate).toEqual([0, 0]);
  });

  it('clearEdges does not touch continuous rates', () => {
    const i = createIntent();
    i.helmRate = 0.5;
    i.aimRate = [0.2, -0.3];
    i.sight = true;
    clearEdges(i);
    expect(i.helmRate).toBe(0.5);
    expect(i.aimRate).toEqual([0.2, -0.3]);
    expect(i.sight).toBe(true);
  });
});
