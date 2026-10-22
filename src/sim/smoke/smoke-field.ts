/** One billow of smoke on the water: a disc that spreads, thins and is carried off by the wind. */
export interface SmokeCloud {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  /** Optical depth through its centre (the sum over clouds along a sight line is what dims the view). */
  depth: number;
  age: number;
  life: number;
  /** The depth and radius it was born with. */
  depth0: number;
  radius0: number;
}

export const SMOKE = {
  /** Radius at birth and at death, metres. */
  radiusBirth: 14,
  radiusDeath: 70,
  /** Optical depth through the centre at birth. Two or three clouds in line are a wall. */
  depthBirth: 3,
  /** Seconds a cloud lasts. */
  life: 150,
  /** Seconds between puffs from a ship making smoke. */
  puffEvery: 0.9,
  /** The wind's share carried on to a cloud (smoke is blown with the air). */
  windFollow: 0.9,
};

/**
 * Smoke laid by ships. It blocks the view along a line of sight in proportion to the thickness of cloud the line passes
 * through, so a destroyer's smoke wall shuts off the rangefinder and the plot long before it hides the ship from the eye.
 */
export class SmokeField {
  readonly clouds: SmokeCloud[] = [];
  /** Wind velocity, m/s. */
  wind: [number, number] = [0, 0];

  /** A puff: `vx, vz` is the velocity of the ship laying it (the smoke drifts off with a share of it, and with the wind). */
  emit(x: number, z: number, vx = 0, vz = 0, scale = 1): void {
    this.clouds.push({
      x,
      z,
      vx: vx * 0.1 + this.wind[0] * SMOKE.windFollow,
      vz: vz * 0.1 + this.wind[1] * SMOKE.windFollow,
      radius: SMOKE.radiusBirth * scale,
      depth: SMOKE.depthBirth,
      age: 0,
      life: SMOKE.life * (0.8 + 0.4 * scale),
      depth0: SMOKE.depthBirth,
      radius0: SMOKE.radiusBirth * scale,
    });
  }

  step(dt: number): void {
    let w = 0;
    for (const c of this.clouds) {
      c.age += dt;
      if (c.age >= c.life) continue;
      const t = c.age / c.life;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.radius = c.radius0 + (SMOKE.radiusDeath - c.radius0) * Math.sqrt(t);
      // A cloud's mass is fixed, so its depth thins as it spreads, and it also bleeds away at the end of its life.
      c.depth = c.depth0 * (c.radius0 / c.radius) * (1 - t * t);
      this.clouds[w++] = c;
    }
    this.clouds.length = w;
  }

  /** Optical depth along the segment from (x1, z1) to (x2, z2). */
  opticalDepth(x1: number, z1: number, x2: number, z2: number): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return 0;
    const len = Math.sqrt(len2);
    let sum = 0;
    for (const c of this.clouds) {
      // Chord of the line through the disc: projection of the centre on the line, and the distance from it.
      const px = c.x - x1;
      const pz = c.z - z1;
      const along = (px * dx + pz * dz) / len;
      const across = Math.abs(px * dz - pz * dx) / len;
      if (across >= c.radius) continue;
      const half = Math.sqrt(c.radius * c.radius - across * across);
      const lo = Math.max(along - half, 0);
      const hi = Math.min(along + half, len);
      if (hi <= lo) continue;
      // Density falls toward the edge; the chord through the centre is the full depth.
      sum += c.depth * ((hi - lo) / (2 * c.radius)) * (1 - across / c.radius);
    }
    return sum;
  }

  /** How much of the view comes through along a line of sight, 0 (shut) to 1 (clear). */
  transmission(x1: number, z1: number, x2: number, z2: number): number {
    return Math.exp(-this.opticalDepth(x1, z1, x2, z2));
  }

  clear(): void {
    this.clouds.length = 0;
  }
}
