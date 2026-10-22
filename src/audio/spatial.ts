/**
 * Where a sound is, as the listener hears it: how long it takes to arrive, how loud it is, which side it comes from and how muffled the
 * distance has made it. Pure functions of positions (metres, world x and z; y is up and does not matter at these ranges).
 */
export const SPEED_OF_SOUND = 343;
/** The longest a sound is kept waiting, in seconds: a gun twenty kilometres off is heard, late, not never. */
export const MAX_DELAY = 60;

export interface Listener {
  x: number;
  z: number;
  /** The way she looks, degrees clockwise from north (the camera's yaw). */
  yawDeg: number;
}

export function distanceTo(l: Listener, x: number, z: number): number {
  return Math.hypot(x - l.x, z - l.z);
}

/** Seconds for the sound to cross `r` metres of air, scaled by `scale` (1 is true; less brings the far guns nearer in time). */
export function soundDelay(r: number, scale = 1): number {
  return Math.min((Math.max(r, 0) / SPEED_OF_SOUND) * scale, MAX_DELAY);
}

/**
 * How much of its loudness reaches the listener: all of it close to, half of it at `ref` metres, and ever less beyond. `ref` is the
 * sound's own reach (a battleship gun carries far, a splash does not).
 */
export function attenuation(r: number, ref: number): number {
  return ref / (ref + Math.max(r, 0));
}

/** -1 (hard left) to 1 (hard right), from where the sound is relative to where she is looking. Very near sounds are not panned hard. */
export function panFor(l: Listener, x: number, z: number): number {
  const dx = x - l.x;
  const dz = z - l.z;
  const r = Math.hypot(dx, dz);
  if (r < 1e-3) return 0;
  const yaw = (l.yawDeg * Math.PI) / 180;
  // The right-hand direction of someone looking along the yaw (north is -z, east is +x).
  const side = (dx * Math.cos(yaw) + dz * Math.sin(yaw)) / r;
  return Math.max(-1, Math.min(1, side)) * 0.9 * Math.min(r / 40, 1);
}

/** The air takes the high notes from a distant sound: the cut-off frequency, in Hz, at range `r`. */
export function lowpassFor(r: number): number {
  return Math.min(900 + 15000 * Math.exp(-Math.max(r, 0) / 2500), 20000);
}

/** In slow motion the whole soundscape drops in pitch, as a film's does: the rate to play at for a game running at `timeScale`. */
export function slowPitch(timeScale: number): number {
  return timeScale >= 1 ? 1 : 0.55 + 0.45 * Math.max(timeScale, 0);
}
