import { Terrain } from './terrain';

const DEG = Math.PI / 180;

/** An island or headland: a rounded hill with a shelving sea floor around it. */
export interface LandMass {
  x: number;
  z: number;
  /** Radii of the shoreline along the mass's own axes, and the turn of those axes (degrees clockwise from north). */
  rx: number;
  rz: number;
  angleDeg?: number;
  /** Height of the summit above the sea, metres. */
  peak: number;
  /** How ragged the ground is, 0 smooth .. 1 very broken. */
  rough?: number;
  /** Shape of the rise from the shore to the summit: below 1 the land climbs steeply from the coast, above 1 it rises gently first. Default 0.9. */
  profile?: number;
  /** Horizontal distance over which the sea floor falls away from the shore to the deep, metres. */
  shelf?: number;
}

/** A shoal: a bank of sea floor lifted toward the surface. */
export interface Bank {
  x: number;
  z: number;
  rx: number;
  rz: number;
  angleDeg?: number;
  /** Least depth of water over the bank, metres. */
  depth: number;
}

export interface TerrainSpec {
  /** Minimum x and z of the grid, its size in metres along x and z, and the lattice spacing. */
  x0: number;
  z0: number;
  width: number;
  length: number;
  cell: number;
  /** Depth of the open sea, metres. */
  seabed: number;
  masses: readonly LandMass[];
  banks?: readonly Bank[];
}

/** Deterministic lattice noise in [0, 1). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/** Fractal noise in about [-1, 1], with the finest wavelength `base` metres and `octaves` doublings coarser. */
function fbm(x: number, z: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let w = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x / w + o * 17.3, z / w - o * 9.1, seed + o) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    w *= 2;
  }
  return sum / norm;
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Normalised elliptical distance from a feature's centre: 1 at its shoreline. */
function ellipse(x: number, z: number, f: { x: number; z: number; rx: number; rz: number; angleDeg?: number }): number {
  const a = (f.angleDeg ?? 0) * DEG;
  const dx = x - f.x;
  const dz = z - f.z;
  // The mass's own axes: z along its heading (north is -z), x across it.
  const u = dx * Math.cos(a) + dz * Math.sin(a);
  const v = -dx * Math.sin(a) + dz * Math.cos(a);
  return Math.hypot(u / f.rx, v / f.rz);
}

/** Lay out the heightfield for a spec: land from the masses, sea floor shelving away from them, banks, and broken ground. */
export function buildTerrain(spec: TerrainSpec, seed = 1): Terrain {
  const nx = Math.round(spec.width / spec.cell) + 1;
  const nz = Math.round(spec.length / spec.cell) + 1;
  const heights = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    const z = spec.z0 + iz * spec.cell;
    for (let ix = 0; ix < nx; ix++) {
      const x = spec.x0 + ix * spec.cell;
      let h = -spec.seabed;
      let land = 0;
      for (const m of spec.masses) {
        const r = ellipse(x, z, m);
        let value: number;
        if (r < 1) {
          // Above the shore: a dome, steeper toward the middle.
          const dome = m.peak * Math.pow(1 - r * r, m.profile ?? 0.9);
          const rough = m.rough ?? 0.4;
          const wobble = fbm(x, z, 90, 5, seed) * rough * m.peak * 0.3 * smooth(0, 0.2, 1 - r);
          value = Math.max(dome + wobble, r > 0.985 ? 0.05 : 0.4);
          land = Math.max(land, value);
        } else {
          // Below it: the shelf falls from the shore to the deep over the shelf width.
          const shelf = m.shelf ?? 380;
          const out = ((r - 1) * Math.min(m.rx, m.rz)) / shelf;
          value = -spec.seabed * (1 - Math.exp(-out * 2.2)) - 0.2;
        }
        if (value > h) h = value;
      }
      for (const b of spec.banks ?? []) {
        const r = ellipse(x, z, b);
        if (r >= 1.6) continue;
        const rise = 1 - smooth(0.55, 1.6, r);
        const floor = -b.depth - fbm(x, z, 60, 3, seed + 99) * 0.8 - 0.8 * (1 - rise);
        const value = -spec.seabed + (floor + spec.seabed) * rise;
        if (value > h && h < 0) h = Math.min(value, -0.5);
      }
      heights[iz * nx + ix] = h;
    }
  }
  return new Terrain({ x0: spec.x0, z0: spec.z0, cell: spec.cell, nx, nz, heights }, spec.seabed);
}
