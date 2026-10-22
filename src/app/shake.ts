import type { EffectName } from './replay';

const TWO_PI = Math.PI * 2;

/** The most the picture is turned by at full trauma, degrees, at a 60-degree field of view. */
const MAX_DEG = 1.4;
/** How fast trauma dies away, per second. */
const DECAY = 1.5;

/** Strength of a blow at distance `r`: all of it close to, half of it at the blow's own `reach`, and ever less beyond. */
export function reachFactor(r: number, reach: number): number {
  return 1 / (1 + (r / reach) ** 2);
}

/**
 * The picture shaken by what happens near the camera: a heavy gun fired from the ship, a shell bursting on her, a magazine going up. It is a
 * "trauma" that every blow adds to and that dies away, and the shake is its square, so that a big blow is felt far more than the
 * small ones together. Only the aim of the camera is moved (a few tenths of a degree, scaled to the field of view so that the
 * sight is not thrown about more than the wide view), and the camera's place is not, so nothing that is measured from it is shaken.
 */
export class CameraShake {
  /** The player's choice: off for anyone whom it makes ill. */
  enabled = true;
  /** Added to the camera's yaw and pitch, degrees. */
  yawDeg = 0;
  pitchDeg = 0;
  private trauma_ = 0;
  private clock = 0;

  get trauma(): number {
    return this.trauma_;
  }

  add(amount: number): void {
    if (this.enabled) this.trauma_ = Math.min(1, this.trauma_ + Math.max(amount, 0));
  }

  /** Move the clock on by `dt` real seconds and work out this frame's turn, for a camera of `fovYDeg`. */
  update(dt: number, fovYDeg = 60): void {
    this.clock += dt;
    this.trauma_ = Math.max(0, this.trauma_ - DECAY * dt);
    const amount = this.trauma_ * this.trauma_ * MAX_DEG * Math.min(fovYDeg / 60, 1.5);
    const t = this.clock * TWO_PI;
    // Sums of unrelated sines: a rumble and a shudder, never the same twice running and never a jump.
    this.yawDeg = amount * (0.7 * Math.sin(t * 3.7 + 1.1) + 0.3 * Math.sin(t * 9.3 + 4.2));
    this.pitchDeg = amount * (0.7 * Math.sin(t * 4.6 + 2.7) + 0.3 * Math.sin(t * 11.1 + 0.4));
  }

  /** A spectacle was drawn: shake for it if it was near. `at` is where the camera is. */
  onEffect(name: EffectName, args: readonly unknown[], at: readonly [number, number, number]): void {
    const dist = (x: number, z: number): number => Math.hypot(x - at[0], z - at[2]);
    switch (name) {
      case 'muzzleBlast': {
        const [muzzle, , caliber] = args as [[number, number, number], unknown, number];
        // A gun is felt only when it is heavy and near: the ship's own broadside, the sight among the turrets.
        if (caliber >= 0.2) this.add(0.08 * (caliber / 0.38) * reachFactor(dist(muzzle[0], muzzle[2]), 150));
        break;
      }
      case 'hitBurst': {
        const [x, , z, caliber] = args as [number, number, number, number];
        this.add(0.9 * Math.min(caliber / 0.38, 1.3) * reachFactor(dist(x, z), 300));
        break;
      }
      case 'armorSpark': {
        const [x, , z, caliber] = args as [number, number, number, number];
        this.add(0.2 * Math.min(caliber / 0.38, 1.3) * reachFactor(dist(x, z), 250));
        break;
      }
      case 'shellSplash': {
        const [x, z, caliber] = args as [number, number, number];
        if (caliber >= 0.2) this.add(0.3 * (caliber / 0.38) * reachFactor(dist(x, z), 100));
        break;
      }
      case 'explosion': {
        const [x, , z, scale] = args as [number, number, number, number];
        this.add(1.1 * Math.min(Math.max(scale ?? 1, 0.5), 2) * reachFactor(dist(x, z), 1500));
        break;
      }
      case 'turretWreck': {
        const [x, , z] = args as [number, number, number];
        this.add(0.6 * reachFactor(dist(x, z), 500));
        break;
      }
      case 'torpedoBlast': {
        const [x, z] = args as [number, number];
        this.add(0.7 * reachFactor(dist(x, z), 600));
        break;
      }
      default:
        break;
    }
  }
}
