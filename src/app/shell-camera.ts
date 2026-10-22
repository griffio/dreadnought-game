import type { ShellShot } from './replay';

type V3 = [number, number, number];

export interface CameraShot {
  position: V3;
  look: V3;
  fovDeg: number;
}

const G = 9.81;
/** How far behind the shell, how high over it and how far to one side the camera rides, metres. */
const BEHIND = 70;
const ABOVE = 8;
const ASIDE = 7;
/** The last seconds of the flight are slowed, and how slow. */
const SLOW_FROM = 3;
const SLOW_TO = 0.3;
/** How long the camera stays on the splash, in the player's own seconds (the game runs slowed meanwhile). */
const DWELL = 1.8;
const FOV = 46;

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Seconds until a shell, flying free, comes down to the sea (drag ignored: this is for the camera's pacing, not for aim). */
export function timeToSea(y: number, vy: number): number {
  const h = Math.max(y, 0);
  return (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
}

/**
 * The shell camera: it rides a shell from behind and a little above and to one side, so that the target grows ahead of it; slows the
 * game for the last seconds of the flight; and when the shell lands holds where it is and looks at the splash for a moment.
 *
 * It is told which shells are in the air each frame (the game's own, live, or the replay's) and picks the newest to follow when it
 * is asked to begin. It knows nothing of the camera itself, only where it should be.
 */
export class ShellCamera {
  state: 'idle' | 'follow' | 'dwell' = 'idle';
  /** The part of the game's speed to run at: 1, easing down to 0.3 for the end of the flight and the splash. */
  timeScale = 1;

  private id = -1;
  private last: ShellShot | null = null;
  private dwellLeft = 0;
  private position: V3 = [0, 0, 0];
  private look: V3 = [0, 0, 0];
  private placed = false;

  /** Begin riding the newest shell, if there is one. Returns whether it began. */
  begin(shells: readonly ShellShot[]): boolean {
    if (shells.length === 0) return false;
    const newest = shells.reduce((a, b) => (b.id > a.id ? b : a));
    this.id = newest.id;
    this.last = newest;
    this.state = 'follow';
    this.placed = false;
    this.timeScale = 1;
    return true;
  }

  /** Stop at once and give the game its full speed back. */
  cancel(): void {
    this.state = 'idle';
    this.timeScale = 1;
    this.last = null;
    this.id = -1;
  }

  get active(): boolean {
    return this.state !== 'idle';
  }

  /** The newest shell id this camera has been told to ride (so that a caller can tell a new salvo from the one just watched). */
  get riding(): number {
    return this.id;
  }

  /** Place the camera for this frame; null when it is idle (or has just finished). */
  update(dt: number, shells: readonly ShellShot[]): CameraShot | null {
    if (this.state === 'idle') return null;
    const shell = shells.find((s) => s.id === this.id) ?? null;
    if (this.state === 'follow') {
      if (shell) {
        this.last = shell;
        const remaining = timeToSea(shell.y, shell.vy);
        this.timeScale = remaining > SLOW_FROM ? 1 : Math.max(SLOW_TO, SLOW_TO + (1 - SLOW_TO) * Math.max(remaining - 0.4, 0) / (SLOW_FROM - 0.4));
        this.ride(dt, shell);
      } else {
        // It has landed: stay put and look at where.
        this.state = 'dwell';
        this.dwellLeft = DWELL;
        this.timeScale = SLOW_TO;
      }
    }
    if (this.state === 'dwell') {
      this.dwellLeft -= dt;
      // The splash is slow, then the game comes back up to speed.
      this.timeScale = this.dwellLeft > 0.5 ? SLOW_TO : SLOW_TO + (1 - SLOW_TO) * (1 - Math.max(this.dwellLeft, 0) / 0.5);
      if (this.dwellLeft <= 0) {
        this.cancel();
        return null;
      }
      const at = this.last!;
      const k = 1 - Math.exp(-dt * 4);
      this.look = [this.look[0] + (at.x - this.look[0]) * k, this.look[1] + (Math.max(at.y, 10) - this.look[1]) * k, this.look[2] + (at.z - this.look[2]) * k];
    }
    return { position: [...this.position] as V3, look: [...this.look] as V3, fovDeg: FOV };
  }

  /** Put the camera behind, above and beside the shell, easing toward that place so that the view does not jitter. */
  private ride(dt: number, shell: ShellShot): void {
    const dir = norm([shell.vx, shell.vy, shell.vz]);
    const side = norm([dir[2], 0, -dir[0]]);
    const want: V3 = [
      shell.x - dir[0] * BEHIND + side[0] * ASIDE,
      Math.max(shell.y - dir[1] * BEHIND + ABOVE, 5),
      shell.z - dir[2] * BEHIND + side[2] * ASIDE,
    ];
    const ahead: V3 = [shell.x + dir[0] * 45, shell.y + dir[1] * 45, shell.z + dir[2] * 45];
    if (!this.placed) {
      this.position = want;
      this.look = ahead;
      this.placed = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < 3; i++) {
      this.position[i] = this.position[i]! + (want[i]! - this.position[i]!) * k;
      this.look[i] = this.look[i]! + (ahead[i]! - this.look[i]!) * k;
    }
  }
}

export type ReplayCameraMode = 'auto' | 'ship' | 'target';
export const REPLAY_CAMERA_MODES: readonly ReplayCameraMode[] = ['auto', 'ship', 'target'];

interface Placed {
  x: number;
  z: number;
  headingDeg: number;
}

/**
 * The replay's camera. Auto rides each of the player's salvos to the splash and, between salvos, circles her own ship; Ship circles
 * her ship; Target circles the nearest enemy, to watch the hits land on her. It is the shell camera and two orbits, easing from the shell
 * to the orbit. (There is no view from above: at the ranges of these fights the haze takes the sea and the ships from it.)
 */
export class ReplayCamera {
  mode: ReplayCameraMode = 'auto';
  private readonly shell = new ShellCamera();
  private angle = 40;
  private ridden = -1;
  private position: V3 = [0, 60, 0];
  private look: V3 = [0, 8, 0];
  private placed = false;
  /** How the replay's clock should be slowed by the camera: 1, or less while it rides the end of a flight. */
  timeScale = 1;

  /** Forget where the camera was (a new replay, or a jump in time). */
  reset(): void {
    this.shell.cancel();
    this.ridden = -1;
    this.placed = false;
    this.timeScale = 1;
  }

  setMode(mode: ReplayCameraMode): void {
    this.mode = mode;
    if (mode !== 'auto') this.shell.cancel();
    this.timeScale = 1;
    // A new view is taken up at once: easing from an overview six kilometres up to a close orbit would take seconds of empty sea.
    this.placed = false;
  }

  /**
   * Place the camera for this frame. `dt` is real seconds, `ships` the ships as they were (the player's first) and `shells` the
   * player's shells in the air.
   */
  update(dt: number, ships: readonly Placed[], shells: readonly ShellShot[]): CameraShot {
    this.angle = (this.angle + dt * 9) % 360;
    this.timeScale = 1;
    if (this.mode === 'auto') {
      // A salvo not yet ridden is ridden; each is watched once.
      const newest = shells.reduce((m, s) => Math.max(m, s.id), -1);
      if (!this.shell.active && newest > this.ridden) {
        this.shell.begin(shells);
        this.ridden = this.shell.riding;
      }
      const shot = this.shell.update(dt, shells);
      this.timeScale = this.shell.active ? this.shell.timeScale : 1;
      if (shot) {
        this.placed = false;
        this.position = [...shot.position] as V3;
        this.look = [...shot.look] as V3;
        return shot;
      }
    }
    return this.orbit(dt, ships);
  }

  private orbit(dt: number, ships: readonly Placed[]): CameraShot {
    const me = ships[0];
    if (!me) return { position: this.position, look: this.look, fovDeg: 60 };
    // The nearest of the others to the player: the foe.
    let foe: Placed | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const s of ships.slice(1)) {
      const d = Math.hypot(s.x - me.x, s.z - me.z);
      if (d < best) {
        best = d;
        foe = s;
      }
    }
    let centre: V3;
    let radius: number;
    let height: number;
    if (this.mode === 'target' && foe) {
      centre = [foe.x, 9, foe.z];
      radius = 330;
      height = 70;
    } else {
      centre = [me.x, 9, me.z];
      radius = 240;
      height = 55;
    }
    const a = (this.angle * Math.PI) / 180;
    const want: V3 = [centre[0] + Math.sin(a) * radius, centre[1] + height, centre[2] - Math.cos(a) * radius];
    if (!this.placed) {
      this.position = want;
      this.look = centre;
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-dt * 2.2);
      for (let i = 0; i < 3; i++) {
        this.position[i] = this.position[i]! + (want[i]! - this.position[i]!) * k;
        this.look[i] = this.look[i]! + (centre[i]! - this.look[i]!) * k;
      }
    }
    return { position: [...this.position] as V3, look: [...this.look] as V3, fovDeg: 60 };
  }
}
