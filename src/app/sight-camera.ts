import type { Camera } from '../render/camera';

const MIN_FOV = 1.5;
const MAX_FOV = 24;
const DEFAULT_FOV = 9;
/** Orbit input arrives in degrees at the chase camera's rate; the sight turns by this fraction of its field of view per 176 of them. */
const INPUT_PER_FOV = 1 / 176;
const ZOOM_PER_NOTCH = 0.72;

export interface SightInput {
  /** The sight is held up. */
  engage: boolean;
  /** Orbit input this frame (drag or stick), degrees at the chase camera's rate. */
  orbit: readonly [number, number];
  /** Zoom notches this frame, positive zooms in. */
  zoom: number;
}

/**
 * The director's sight: a narrow-field camera at the foretop, locked on the designated target (or free to look anywhere
 * when there is none), with a drag to nudge the view and a zoom to bring a ship ten kilometres off close enough to see its
 * splashes. Dragging reads like holding the world, so the view moves opposite to the finger.
 *
 * It remembers how you had it. Let it down and raise it again and the zoom is as you left it, the nudge off the target is
 * kept (until you lock a different target, when it would mean nothing), and in free look the bearing you were looking on is
 * kept relative to the ship, so a turn of the ship in between does not lose it.
 */
export class SightCamera {
  fovDeg = Number.NaN;
  /** Where the sight is looking, degrees (compass yaw, pitch above the horizon). */
  yawDeg = 0;
  pitchDeg = 0;

  private targetFov = DEFAULT_FOV;
  private engaged = false;
  private offsetYaw = 0;
  private offsetPitch = 0;
  /** Free look: where the sight was pointing, relative to the ship's heading (degrees). */
  private relativeYaw = 0;
  /** Which target the nudge belongs to; undefined before the first frame. */
  private lockId: number | null | undefined = undefined;

  /** True while the sight owns the camera (including the moment it takes to zoom back out). */
  get owns(): boolean {
    return this.engaged || this.fovDeg < this.releaseFov * 0.85;
  }

  private releaseFov = 60;

  /**
   * Place the camera for this frame. `lookAt` is the point to hold the sight on, or null; `lockId` says which target that is
   * (so a nudge is not carried over to a different one); `headingDeg` is the ship's.
   * Returns true when the sight is in charge of the camera this frame.
   */
  update(
    dt: number,
    camera: Camera,
    input: SightInput,
    anchor: readonly [number, number, number],
    lookAt: readonly [number, number, number] | null,
    headingDeg: number,
    baseFov: number,
    lockId: number | null = null,
  ): boolean {
    this.releaseFov = baseFov;
    if (Number.isNaN(this.fovDeg)) this.fovDeg = baseFov;
    dt = Math.min(Math.max(dt, 0), 0.1);
    // A nudge is relative to one target: a new target starts from the target itself.
    if (this.lockId !== undefined && lockId !== this.lockId) {
      this.offsetYaw = 0;
      this.offsetPitch = 0;
    }
    this.lockId = lockId;
    if (input.engage && !this.engaged) {
      this.engaged = true;
      if (!lookAt) {
        // Free look picks up where it was left, as a bearing from the bow.
        this.yawDeg = headingDeg + this.relativeYaw;
        if (this.pitchDeg === 0) this.pitchDeg = 1;
      }
    } else if (!input.engage && this.engaged) {
      this.engaged = false;
    }

    this.targetFov = Math.min(Math.max(this.targetFov * Math.pow(ZOOM_PER_NOTCH, this.engaged ? input.zoom : 0), MIN_FOV), MAX_FOV);
    const goal = this.engaged ? this.targetFov : baseFov;
    this.fovDeg += (goal - this.fovDeg) * (1 - Math.exp(-dt * (this.engaged ? 9 : 14)));

    if (!this.owns) return false;

    if (this.engaged) {
      const k = this.fovDeg * INPUT_PER_FOV;
      const dyaw = -input.orbit[0] * k;
      const dpitch = input.orbit[1] * k;
      if (lookAt) {
        this.offsetYaw += dyaw;
        this.offsetPitch += dpitch;
      } else {
        this.yawDeg += dyaw;
        this.pitchDeg = Math.min(Math.max(this.pitchDeg + dpitch, -20), 30);
      }
    }
    if (lookAt) {
      const dx = lookAt[0] - anchor[0];
      const dy = lookAt[1] - anchor[1];
      const dz = lookAt[2] - anchor[2];
      this.yawDeg = (Math.atan2(dx, -dz) * 180) / Math.PI + this.offsetYaw;
      this.pitchDeg = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI + this.offsetPitch;
    }

    // Whatever it is looking at now is where free look will resume from.
    this.relativeYaw = (((this.yawDeg - headingDeg) % 360) + 540) % 360 - 180;
    camera.position = [anchor[0], anchor[1], anchor[2]];
    camera.yawDeg = this.yawDeg;
    camera.pitchDeg = this.pitchDeg;
    camera.fovYDeg = this.fovDeg;
    return true;
  }
}
