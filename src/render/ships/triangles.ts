/**
 * A ship's triangles in two runs. The hull and decks are the sheets that cover most of her pixels; everything else (turrets, superstructure,
 * funnels, masts, guns, boats) is her works. The sight's cutaway and a ship broken in two both have to leave pixels out of her works, and a
 * pipeline that can discard costs a tile-based GPU its hidden-surface removal for everything it draws, so the works alone are drawn with it
 * and the sheets are not (a broken ship's sheets are cut in the vertex shader instead). The works are sorted by the height of their highest
 * corner, so that the run that can reach as high as the cutaway's lens is a tail of them.
 */
export interface SortedTriangles {
  /** The model's indices, three to a triangle: the sheets first, then the works lowest first. */
  indices: Uint32Array;
  /** Where the works begin, as an index (not a triangle). */
  worksStart: number;
  /** The height of the highest corner of each of the works' triangles, ascending. */
  maxY: Float32Array;
}

/**
 * `vertices` is the Forge's interleaved buffer (8 words a vertex: position, normal, ids with the material in bits 8-15, aux); `indices` are
 * triangles; `sheets` the materials that are sheets (the hull's and the decks').
 */
export function sortTriangles(vertices: ArrayBuffer, indices: Uint32Array, sheets: ReadonlySet<number>): SortedTriangles {
  const f = new Float32Array(vertices);
  const ids = new Uint32Array(vertices);
  const count = Math.floor(indices.length / 3);
  const top = new Float32Array(count);
  const isSheet = new Uint8Array(count);
  for (let t = 0; t < count; t++) {
    top[t] = Math.max(f[indices[t * 3]! * 8 + 1]!, f[indices[t * 3 + 1]! * 8 + 1]!, f[indices[t * 3 + 2]! * 8 + 1]!);
    isSheet[t] = sheets.has((ids[indices[t * 3]! * 8 + 6]! >> 8) & 0xff) ? 1 : 0;
  }
  // Sheets first (in their order), then works by height (in their order when level).
  const order = Array.from({ length: count }, (_, t) => t).sort((a, b) => isSheet[b]! - isSheet[a]! || (isSheet[a] ? a - b : top[a]! - top[b]! || a - b));
  const sorted = new Uint32Array(count * 3);
  const sheetCount = isSheet.reduce((n, v) => n + v, 0);
  const maxY = new Float32Array(count - sheetCount);
  order.forEach((t, i) => {
    sorted[i * 3] = indices[t * 3]!;
    sorted[i * 3 + 1] = indices[t * 3 + 1]!;
    sorted[i * 3 + 2] = indices[t * 3 + 2]!;
    if (i >= sheetCount) maxY[i - sheetCount] = top[t]!;
  });
  return { indices: sorted, worksStart: sheetCount * 3, maxY };
}

/** The index (not the triangle), counted from the start of the works, of the first of them whose highest corner is above `y`. */
export function firstIndexAbove(maxY: Float32Array, y: number): number {
  let lo = 0;
  let hi = maxY.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (maxY[mid]! > y) hi = mid;
    else lo = mid + 1;
  }
  return lo * 3;
}
