import { clearEdges, createIntent, resetLevels, type InputDevice, type Intent } from './intent';

export interface InputSource {
  readonly device: InputDevice;
  /** Write this device's demands into `out`. Return true if the device had any activity this frame. */
  poll(out: Intent): boolean;
}

/**
 * Merges every attached device into one Intent and tracks which device was used last, so the HUD can swap
 * layouts and button glyphs without a restart.
 */
export class InputManager {
  readonly intent: Intent = createIntent();
  private active: InputDevice;
  private readonly listeners = new Set<(device: InputDevice) => void>();

  constructor(
    private readonly sources: readonly InputSource[],
    initial: InputDevice = 'keyboard-mouse',
  ) {
    this.active = initial;
  }

  get activeDevice(): InputDevice {
    return this.active;
  }

  onDeviceChange(fn: (device: InputDevice) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Poll every source into the shared Intent. Call once per rendered frame, before stepping the sim. */
  update(): Intent {
    resetLevels(this.intent);
    let latest: InputDevice | null = null;
    for (const source of this.sources) {
      if (source.poll(this.intent)) latest = source.device;
    }
    if (latest !== null && latest !== this.active) {
      this.active = latest;
      for (const fn of this.listeners) fn(latest);
    }
    return this.intent;
  }

  /** Call after the sim steps have consumed this frame's edge events. */
  endFrame(): void {
    clearEdges(this.intent);
  }
}
