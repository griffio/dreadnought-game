const DEG = Math.PI / 180;

/** How hard a flag ripples at an apparent wind of `speed` m/s: hanging limp in a calm, rippling a good deal at a fresh breeze, and no more than that. */
export function rippleAt(speed: number): number {
  return Math.min(Math.max(speed / 11, 0.2), 1);
}

/**
 * The way a ship's flags stream and how hard the wind on them is: the true wind (blowing toward `windToDeg`, compass degrees, at
 * `windSpeed` m/s) less the ship's own motion (heading `headingDeg`, `speed` m/s). `angle` is in the ship's own frame, radians from the
 * bow and positive toward starboard: pi is straight aft (a ship steaming through still air), and a flag lies out to leeward when she is
 * stopped. North is -z, as everywhere in the game.
 */
export function flagStreaming(headingDeg: number, speed: number, windToDeg: number, windSpeed: number): { angle: number; speed: number } {
  const h = headingDeg * DEG;
  const w = windToDeg * DEG;
  const wx = Math.sin(w) * windSpeed - Math.sin(h) * speed;
  const wz = -Math.cos(w) * windSpeed + Math.cos(h) * speed;
  const along = wx * Math.sin(h) - wz * Math.cos(h);
  const across = wx * Math.cos(h) + wz * Math.sin(h);
  return { angle: Math.atan2(across, along), speed: Math.hypot(along, across) };
}
