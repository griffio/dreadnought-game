import { degToRad } from '../math/vec3';
import type { Camera } from '../render/camera';

const MIN_DISTANCE = 45;
const MAX_DISTANCE = 700;
const MIN_PITCH = 2;
const MAX_PITCH = 80;
const MIN_HEIGHT = 3.5;

function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Orbit camera that follows a ship. The orbit angle is relative to the ship's heading, so the view swings round
 * behind it as it turns (with a little lag, which makes turns read as turns). Drag/stick orbits, pinch/wheel zooms.
 */
export class ChaseCamera {
  /** Where the camera sits around the ship, degrees clockwise from dead ahead: 180 = directly astern. */
  orbitDeg = 158;
  /** Elevation above the horizon, degrees. */
  pitchDeg = 13;
  distance = 230;
  /** Height of the look-at point above the waterline. */
  lookHeight = 9;

  private followHeading = 0;
  private initialised = false;

  constructor(private readonly camera: Camera) {}

  /** Apply this frame's orbit/zoom input and place the camera around `target` (world x, z; heading in degrees). */
  update(dt: number, target: { x: number; y: number; z: number; headingDeg: number }, orbit: readonly [number, number], zoomNotches: number): void {
    if (!this.initialised) {
      this.followHeading = target.headingDeg;
      this.initialised = true;
    }
    this.orbitDeg = (this.orbitDeg + orbit[0]) % 360;
    this.pitchDeg = Math.min(Math.max(this.pitchDeg + orbit[1], MIN_PITCH), MAX_PITCH);
    this.distance = Math.min(Math.max(this.distance * Math.pow(0.88, zoomNotches), MIN_DISTANCE), MAX_DISTANCE);
    this.followHeading += angleDelta(this.followHeading, target.headingDeg) * (1 - Math.exp(-dt * 1.4));

    const az = degToRad(this.followHeading + this.orbitDeg);
    const pitch = degToRad(this.pitchDeg);
    const horizontal = Math.cos(pitch) * this.distance;
    const lx = target.x;
    const ly = target.y + this.lookHeight;
    const lz = target.z;
    const cx = lx + Math.sin(az) * horizontal;
    const cz = lz - Math.cos(az) * horizontal;
    const cy = Math.max(ly + Math.sin(pitch) * this.distance, MIN_HEIGHT);
    this.camera.position = [cx, cy, cz];
    this.camera.lookAt(lx, ly, lz);
  }
}
