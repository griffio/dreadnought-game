import { MATERIAL, type MeshBuilder, type V3 } from './mesh-builder';

export interface BulwarkSpan {
  /** Fraction of length (0 = stern, 1 = bow) the wall runs between. */
  from: number;
  to: number;
  height: number;
}

/**
 * Parametric hull. Everything is a function of u in [0, 1] (stern to bow) and height above the waterline,
 * so the Forge can loft any hull from a handful of numbers and the sim can query the same surface.
 */
export interface HullSpec {
  length: number;
  beam: number;
  draft: number;
  /** Deck height above the waterline at the stern, amidships and at the bow (sheer). */
  deckStern: number;
  deckMid: number;
  deckBow: number;
  /** Fraction of length taken by the rounded stern. */
  sternRound: number;
  /** Where (u) the parallel body ends and the bow taper begins. */
  bodyEnd: number;
  /** Bow waterline curve exponent: higher is fuller, lower is sharper. */
  bowCurve: number;
  /** Superellipse exponent of the bilge below the waterline. */
  bilge: number;
  /** Extra half-beam at deck level at the bow, as a fraction. */
  flareBow: number;
  /** Narrowing at deck level amidships, as a fraction. */
  tumblehome: number;
  /** Forward lean of the stem at deck level, metres. */
  bowRake: number;
  /** Aft overhang of the counter at deck level, metres. */
  sternOverhang: number;
  bulwarks: BulwarkSpan[];
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Waterline half-breadth in metres at u. */
export function waterlineHalfBreadth(h: HullSpec, u: number): number {
  const half = h.beam / 2;
  if (u <= 0 || u >= 1) return 0;
  if (u < h.sternRound) {
    const t = 1 - u / h.sternRound;
    return half * Math.sqrt(Math.max(1 - t * t, 0));
  }
  if (u <= h.bodyEnd) return half;
  const t = (u - h.bodyEnd) / (1 - h.bodyEnd);
  return half * (1 - Math.pow(t, h.bowCurve));
}

export function deckHeight(h: HullSpec, u: number): number {
  if (u >= 0.5) return h.deckMid + (h.deckBow - h.deckMid) * Math.pow((u - 0.5) * 2, 2.2);
  return h.deckMid + (h.deckStern - h.deckMid) * Math.pow((0.5 - u) * 2, 2.2);
}

/** Depth of the keel below the waterline at u (rises toward the stem and the stern post). */
export function keelDepth(h: HullSpec, u: number): number {
  return h.draft * (1 - 0.55 * Math.pow(Math.abs(2 * u - 1), 5));
}

/** Half-breadth at height y (negative below the waterline) for a station at u. */
export function halfBreadthAt(h: HullSpec, u: number, y: number): number {
  const wl = waterlineHalfBreadth(h, u);
  if (y <= 0) {
    const eta = Math.min(-y / keelDepth(h, u), 1);
    return wl * Math.pow(Math.max(1 - Math.pow(eta, h.bilge), 0), 1 / h.bilge);
  }
  const f = Math.min(y / deckHeight(h, u), 1);
  const flare = h.flareBow * smoothstep(0.55, 1, u);
  return wl * (1 + flare * Math.pow(f, 1.6) - h.tumblehome * f);
}

/** Forward/aft shift of a point so the stem and counter rake over at deck level. */
function rakeOffset(h: HullSpec, u: number, y: number): number {
  const d = keelDepth(h, u);
  const f = Math.min(Math.max((y + d) / (deckHeight(h, u) + d), 0), 1);
  const bow = h.bowRake * Math.pow(smoothstep(0.8, 1, u), 1.5) * f;
  const stern = h.sternOverhang * Math.pow(smoothstep(0.2, 0, u), 1.5) * f;
  return bow - stern;
}

const STATIONS = 72;
const ABOVE_STEPS = 6;
const BELOW_STEPS = 10;

function stationU(i: number): number {
  return 0.5 * (1 - Math.cos((Math.PI * i) / (STATIONS - 1)));
}

/** Heights of the ring points from the deck down to the keel at a station. */
function ringHeights(h: HullSpec, u: number): number[] {
  const deck = deckHeight(h, u);
  const d = keelDepth(h, u);
  const ys: number[] = [];
  for (let k = 0; k < ABOVE_STEPS; k++) ys.push(deck * (1 - k / ABOVE_STEPS));
  for (let k = 0; k <= BELOW_STEPS; k++) ys.push(-d * (k / BELOW_STEPS));
  return ys;
}

/** Build the hull shell, deck and bulwarks into the builder (node and material are set here). */
export function buildHull(b: MeshBuilder, h: HullSpec): void {
  const xOf = (u: number) => (u - 0.5) * h.length;
  const side: V3[][] = [];
  const deck: V3[][] = [];

  for (let i = 0; i < STATIONS; i++) {
    const u = stationU(i);
    const x0 = xOf(u);
    const ys = ringHeights(h, u);
    const port: V3[] = ys.map((y) => [x0 + rakeOffset(h, u, y), y, -halfBreadthAt(h, u, y)]);
    const starboard: V3[] = ys
      .slice(0, -1)
      .map((y): V3 => [x0 + rakeOffset(h, u, y), y, halfBreadthAt(h, u, y)])
      .reverse();
    side.push([...port, ...starboard]);

    const top = ys[0]!;
    const edge = halfBreadthAt(h, u, top);
    const xTop = x0 + rakeOffset(h, u, top);
    const row: V3[] = [];
    const columns = 7;
    for (let c = 0; c < columns; c++) {
      const s = (c / (columns - 1)) * 2 - 1;
      row.push([xTop, top + 0.16 * (1 - s * s), s * edge]);
    }
    deck.push(row);
  }

  b.node = 0;
  b.material = MATERIAL.HULL;
  b.grid(side);
  b.material = MATERIAL.DECK;
  b.grid(deck, { flip: true });

  // Bulwarks: a thin wall along the deck edge, with hard edges (three separate strips per side).
  b.material = MATERIAL.HULL;
  for (const span of h.bulwarks) {
    for (const s of [-1, 1]) {
      const rows: { base: V3; top: V3; innerTop: V3; innerBase: V3 }[] = [];
      for (let i = 0; i < STATIONS; i++) {
        const u = stationU(i);
        if (u < span.from || u > span.to) continue;
        const y = deckHeight(h, u);
        const x = xOf(u) + rakeOffset(h, u, y);
        const z = s * halfBreadthAt(h, u, y);
        const t = 0.14 * s;
        rows.push({
          base: [x, y, z],
          top: [x, y + span.height, z],
          innerTop: [x, y + span.height, z - t],
          innerBase: [x, y + 0.1, z - t],
        });
      }
      if (rows.length < 2) continue;
      const flip = s < 0;
      b.grid(rows.map((r) => [r.base, r.top]), { flip });
      b.grid(rows.map((r) => [r.top, r.innerTop]), { flip });
      b.grid(rows.map((r) => [r.innerTop, r.innerBase]), { flip });
    }
  }
}

/** Deck height (above the waterline) at a ship-space x. Used to seat turrets and superstructure. */
export function deckHeightAtX(h: HullSpec, x: number): number {
  return deckHeight(h, Math.min(Math.max(x / h.length + 0.5, 0), 1)) + 0.16;
}
