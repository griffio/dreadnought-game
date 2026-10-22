/**
 * The marks a ship carries: scorch and shell holes where she has been hit, as a short list the ship shader projects onto the hull in
 * ship space. Pure data, so it can be tested without a GPU. A ship keeps the last `MAX_DECALS`: a new one overwrites the oldest.
 */
export const MAX_DECALS = 32;
/** Floats per decal in the shader's uniform: three vec4s. */
export const DECAL_FLOATS = 12;

/** Which picture a decal is (the layers of decals.png, see tools/process-textures.py). */
export const DECAL_SCORCH = 0;
export const DECAL_SOFT = 1;
export const DECAL_HOLE = 2;
export type DecalKind = typeof DECAL_SCORCH | typeof DECAL_SOFT | typeof DECAL_HOLE;

export interface Decal {
  /** Where it is, ship space (x forward, y up from the waterline, z to starboard), and how far its square reaches from the centre. */
  x: number;
  y: number;
  z: number;
  radius: number;
  /** The way the surface it is on faces (unit). */
  nx: number;
  ny: number;
  nz: number;
  kind: DecalKind;
  /** Simulation time it was made: before that it is not shown (a replay of an earlier moment sees the ship as she was). */
  created: number;
  /** 0..1, turns the picture so that two holes are not the same hole. */
  seed: number;
}

export class DecalSet {
  readonly items: Decal[] = [];
  private next = 0;

  get count(): number {
    return this.items.length;
  }

  add(d: Decal): void {
    if (this.items.length < MAX_DECALS) this.items.push(d);
    else {
      this.items[this.next] = d;
      this.next = (this.next + 1) % MAX_DECALS;
    }
  }

  clear(): void {
    this.items.length = 0;
    this.next = 0;
  }

  /** Write them as the shader reads them, from `offset` in `out`: (x y z radius), (nx ny nz kind), (created seed 0 0). */
  pack(out: Float32Array, offset: number): void {
    out.fill(0, offset, offset + MAX_DECALS * DECAL_FLOATS);
    this.items.forEach((d, i) => {
      const o = offset + i * DECAL_FLOATS;
      out[o] = d.x;
      out[o + 1] = d.y;
      out[o + 2] = d.z;
      out[o + 3] = d.radius;
      out[o + 4] = d.nx;
      out[o + 5] = d.ny;
      out[o + 6] = d.nz;
      out[o + 7] = d.kind;
      out[o + 8] = d.created;
      out[o + 9] = d.seed;
    });
  }
}

/** What the damage model tells the picture about a hit: where, which way the surface faced, how big the shell, and what became of it. */
export interface HitMark {
  at: readonly [number, number, number];
  normal: readonly [number, number, number];
  caliberM: number;
  /** burst: it got in and burst; pass: it went through light structure; shatter: it broke up on armour; ricochet: it glanced off. */
  kind: 'burst' | 'pass' | 'shatter' | 'ricochet';
  /** The plate it struck first. */
  plate: string;
}

/** The plates that are part of the static hull and its works: a mark can lie on them. Turrets turn, and the bottom is under water. */
const MARKABLE = new Set(['belt', 'side', 'upper-side', 'deck', 'end', 'funnel', 'bridge', 'conning']);

export function markable(plate: string): boolean {
  return MARKABLE.has(plate);
}

const fract = (v: number): number => v - Math.floor(v);

/** A number from 0 to 1 that is the same for the same hit (so that marks are reproducible) and differs between hits. */
function seedOf(h: HitMark, now: number): number {
  return fract(Math.sin(h.at[0] * 12.9898 + h.at[1] * 78.233 + h.at[2] * 37.719 + now * 4.1414) * 43758.5453);
}

/**
 * The decals a hit leaves. A shell that bursts inside punches a hole and scorches a wide patch around it; one that goes through light
 * structure leaves a clean small hole; one that breaks up on armour leaves a soft scorch; a glancing one a scuff. A mark under the water
 * or on a part that is not the static hull leaves nothing.
 */
export function decalsForHit(h: HitMark, now: number): Decal[] {
  if (!markable(h.plate) || h.at[1] < -0.2) return [];
  const c = Math.min(Math.max(h.caliberM / 0.305, 0.25), 1.8);
  const seed = seedOf(h, now);
  const base = { x: h.at[0], y: h.at[1], z: h.at[2], nx: h.normal[0], ny: h.normal[1], nz: h.normal[2], created: now, seed };
  switch (h.kind) {
    case 'burst': {
      const hole = Math.min(Math.max(1.0 * c, 0.35), 2.2);
      return [
        { ...base, radius: hole * 2.1, kind: DECAL_SCORCH },
        { ...base, radius: hole, kind: DECAL_HOLE },
      ];
    }
    case 'pass':
      return [{ ...base, radius: Math.max(0.55 * c, 0.25), kind: DECAL_HOLE }];
    case 'shatter':
      return [{ ...base, radius: 1.5 * c, kind: DECAL_SOFT }];
    case 'ricochet':
      return [{ ...base, radius: 0.8 * c, kind: DECAL_SOFT }];
  }
}
