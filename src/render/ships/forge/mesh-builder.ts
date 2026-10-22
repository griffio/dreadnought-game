/**
 * Procedural mesh builder for the ship Forge. Everything is emitted as indexed triangles with per-vertex
 * normals, tagged with the animation node it belongs to and a material id the ship shader switches on.
 *
 * Ship space: +x bow-ward, +y up, +z starboard, origin amidships at the design waterline.
 * Primitives are authored in a local frame and placed with the transform stack (translate/rotate/basis).
 */
export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

/** Material ids; ship.wgsl switches on these. Keep in sync. */
export const MATERIAL = {
  HULL: 0,
  DECK: 1,
  SUPERSTRUCTURE: 2,
  FUNNEL: 3,
  GUN: 4,
  TURRET: 5,
  MAST: 6,
  WOOD: 7,
  BLACK: 8,
  BRASS: 9,
  FLAG: 10,
} as const;
export type MaterialId = (typeof MATERIAL)[keyof typeof MATERIAL];

/** Interleaved vertex: position(3f) normal(3f) ids(u32: node | material << 8) aux(u32, reserved). */
export const VERTEX_STRIDE_BYTES = 32;

type M4 = Float64Array;

const ident = (): M4 => Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly ids: number[] = [];
  readonly aux: number[] = [];
  readonly indices: number[] = [];
  /** Animation node new geometry attaches to. */
  node = 0;
  material: MaterialId = MATERIAL.SUPERSTRUCTURE;
  /** Free per-vertex payload for the shader (funnels store their top height in decimetres). */
  auxValue = 0;

  private stack: M4[] = [ident()];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  // ---- transform stack -------------------------------------------------------------------------

  private get top(): M4 {
    return this.stack[this.stack.length - 1]!;
  }

  private pushMatrix(m: M4): void {
    this.stack.push(mul(this.top, m));
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  translate(x: number, y: number, z: number): this {
    const m = ident();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    this.pushMatrix(m);
    return this;
  }

  rotateY(angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.pushMatrix(Float64Array.of(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1));
    return this;
  }

  rotateZ(angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.pushMatrix(Float64Array.of(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    return this;
  }

  rotateX(angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.pushMatrix(Float64Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1));
    return this;
  }

  /** Frame at `origin` whose local +x points along `axis` (any perpendicular frame for y/z). */
  alongAxis(origin: V3, axis: V3): this {
    const x = norm(axis);
    const helper: V3 = Math.abs(x[1]) < 0.95 ? [0, 1, 0] : [0, 0, 1];
    const z = norm(cross(x, helper));
    const y = cross(z, x);
    this.pushMatrix(Float64Array.of(x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, origin[0], origin[1], origin[2], 1));
    return this;
  }

  /** Run `fn` inside a pushed transform, popping it afterwards. */
  within(push: (b: this) => void, fn: () => void): void {
    const depth = this.stack.length;
    push(this);
    fn();
    while (this.stack.length > depth) this.stack.pop();
  }

  private tp(p: V3): V3 {
    const m = this.top;
    return [
      m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
      m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
      m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
    ];
  }

  private tn(n: V3): V3 {
    const m = this.top;
    return norm([
      m[0]! * n[0] + m[4]! * n[1] + m[8]! * n[2],
      m[1]! * n[0] + m[5]! * n[1] + m[9]! * n[2],
      m[2]! * n[0] + m[6]! * n[1] + m[10]! * n[2],
    ]);
  }

  // ---- raw emission ----------------------------------------------------------------------------

  vertex(p: V3, n: V3): number {
    const wp = this.tp(p);
    const wn = this.tn(n);
    this.positions.push(wp[0], wp[1], wp[2]);
    this.normals.push(wn[0], wn[1], wn[2]);
    this.ids.push((this.node & 0xff) | ((this.material & 0xff) << 8));
    this.aux.push(this.auxValue >>> 0);
    return this.vertexCount - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  // ---- flat-shaded shapes ----------------------------------------------------------------------

  /** One flat quad; corners in order around the face. Normal from winding unless given. */
  quad(a: V3, b: V3, c: V3, d: V3, normal?: V3): void {
    const n = normal ?? norm(cross(sub(b, a), sub(d, a)));
    const i = this.vertex(a, n);
    this.vertex(b, n);
    this.vertex(c, n);
    this.vertex(d, n);
    this.triangle(i, i + 1, i + 2);
    this.triangle(i, i + 2, i + 3);
  }

  /**
   * Prism: extrude a convex counter-clockwise (x, y) profile from z0 to z1. Flat-shaded walls, flat caps.
   */
  extrude(profile: readonly V2[], z0: number, z1: number): void {
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const p = profile[i]!;
      const q = profile[(i + 1) % n]!;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) continue;
      const nrm: V3 = [dy / l, -dx / l, 0];
      this.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], nrm);
    }
    for (const [z, nz] of [
      [z1, 1],
      [z0, -1],
    ] as const) {
      const first = this.vertexCount;
      for (const p of profile) this.vertex([p[0], p[1], z], [0, 0, nz]);
      for (let i = 1; i < n - 1; i++) this.triangle(first, first + i, first + i + 1);
    }
  }

  /** Axis-aligned box centred on (cx, cy, cz). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
    const hx = sx / 2;
    const hy = sy / 2;
    this.extrude(
      [
        [cx - hx, cy - hy],
        [cx + hx, cy - hy],
        [cx + hx, cy + hy],
        [cx - hx, cy + hy],
      ],
      cz - sz / 2,
      cz + sz / 2,
    );
  }

  // ---- surfaces of revolution ------------------------------------------------------------------

  /**
   * Lathe a (t, r) profile around the local +x axis. `ex`/`ez` scale the cross-section into an ellipse
   * (funnels). Smooth normals. Cap discs are flat.
   */
  lathe(
    profile: readonly V2[],
    segments = 16,
    opts: { ex?: number; ez?: number; capStart?: boolean; capEnd?: boolean } = {},
  ): void {
    const ex = opts.ex ?? 1;
    const ez = opts.ez ?? 1;
    const n = profile.length;
    const first = this.vertexCount;
    for (let i = 0; i < n; i++) {
      const prev = profile[Math.max(i - 1, 0)]!;
      const next = profile[Math.min(i + 1, n - 1)]!;
      const dt = next[0] - prev[0];
      const dr = next[1] - prev[1];
      const tl = Math.hypot(dt, dr) || 1;
      const nt = -dr / tl;
      const nr = dt / tl;
      const [t, r] = profile[i]!;
      for (let s = 0; s <= segments; s++) {
        const phi = (s / segments) * Math.PI * 2;
        const cy = Math.cos(phi);
        const sz = Math.sin(phi);
        this.vertex([t, r * ex * cy, r * ez * sz], [nt, (nr * cy) / ex, (nr * sz) / ez]);
      }
    }
    const row = segments + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < segments; s++) {
        const a = first + i * row + s;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        this.triangle(a, c, b);
        this.triangle(b, c, d);
      }
    }
    const cap = (t: number, r: number, nx: number) => {
      if (r <= 0) return;
      const centre = this.vertex([t, 0, 0], [nx, 0, 0]);
      const ring = this.vertexCount;
      for (let s = 0; s <= segments; s++) {
        const phi = (s / segments) * Math.PI * 2;
        this.vertex([t, r * ex * Math.cos(phi), r * ez * Math.sin(phi)], [nx, 0, 0]);
      }
      for (let s = 0; s < segments; s++) this.triangle(centre, ring + s, ring + s + 1);
    };
    if (opts.capStart) cap(profile[0]![0], profile[0]![1], -1);
    if (opts.capEnd) cap(profile[n - 1]![0], profile[n - 1]![1], 1);
  }

  /** Tapered round bar between two points (masts, legs, barrels' simple cousins). */
  tube(p0: V3, p1: V3, r0: number, r1 = r0, segments = 10, caps = false): void {
    const axis = sub(p1, p0);
    const length = len(axis);
    if (length < 1e-6) return;
    this.within(
      (b) => b.alongAxis(p0, axis),
      () =>
        this.lathe(
          [
            [0, r0],
            [length, r1],
          ],
          segments,
          { capStart: caps, capEnd: caps },
        ),
    );
  }

  // ---- lofted surfaces -------------------------------------------------------------------------

  /**
   * Smooth surface through a grid of points. Rows run along the ship (stern to bow), columns around the
   * section. Normals are area-weighted averages of face normals; `flip` reverses the orientation, and
   * `wrapColumns` joins the last column back to the first.
   */
  grid(rows: readonly V3[][], opts: { flip?: boolean; wrapColumns?: boolean } = {}): void {
    const nr = rows.length;
    const nc = rows[0]!.length;
    const accum = new Float64Array(nr * nc * 3);
    const flip = opts.flip ? -1 : 1;
    const colCount = opts.wrapColumns ? nc : nc - 1;
    const at = (r: number, c: number): V3 => rows[r]![c % nc]!;
    const addNormal = (vertex: number, n: V3) => {
      for (let k = 0; k < 3; k++) accum[vertex * 3 + k] = accum[vertex * 3 + k]! + n[k]! * flip;
    };

    for (let r = 0; r < nr - 1; r++) {
      for (let c = 0; c < colCount; c++) {
        const p00 = at(r, c);
        const p01 = at(r, c + 1);
        const p10 = at(r + 1, c);
        const p11 = at(r + 1, c + 1);
        // Two triangles; area-weighted normals are the unnormalised cross products.
        const n1 = cross(sub(p10, p00), sub(p01, p00));
        const n2 = cross(sub(p11, p10), sub(p01, p10));
        const v00 = r * nc + (c % nc);
        const v01 = r * nc + ((c + 1) % nc);
        const v10 = (r + 1) * nc + (c % nc);
        const v11 = (r + 1) * nc + ((c + 1) % nc);
        for (const v of [v00, v10, v01]) addNormal(v, n1);
        for (const v of [v01, v10, v11]) addNormal(v, n2);
      }
    }

    const first = this.vertexCount;
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const i = (r * nc + c) * 3;
        let n: V3 = [accum[i]!, accum[i + 1]!, accum[i + 2]!];
        if (len(n) < 1e-12) n = [0, 1, 0]; // fully degenerate (collapsed bow/stern point)
        this.vertex(rows[r]![c]!, n);
      }
    }
    for (let r = 0; r < nr - 1; r++) {
      for (let c = 0; c < colCount; c++) {
        const a = first + r * nc + (c % nc);
        const b = first + r * nc + ((c + 1) % nc);
        const cc = first + (r + 1) * nc + (c % nc);
        const d = first + (r + 1) * nc + ((c + 1) % nc);
        this.triangle(a, cc, b);
        this.triangle(b, cc, d);
      }
    }
  }

  // ---- output ----------------------------------------------------------------------------------

  /** Pack into the interleaved layout the ship pipeline expects. */
  pack(): { vertices: ArrayBuffer; indices: Uint32Array; vertexCount: number } {
    const count = this.vertexCount;
    const buffer = new ArrayBuffer(count * VERTEX_STRIDE_BYTES);
    const f = new Float32Array(buffer);
    const u = new Uint32Array(buffer);
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      f[o] = this.positions[i * 3]!;
      f[o + 1] = this.positions[i * 3 + 1]!;
      f[o + 2] = this.positions[i * 3 + 2]!;
      f[o + 3] = this.normals[i * 3]!;
      f[o + 4] = this.normals[i * 3 + 1]!;
      f[o + 5] = this.normals[i * 3 + 2]!;
      u[o + 6] = this.ids[i]!;
      u[o + 7] = this.aux[i]!;
    }
    return { vertices: buffer, indices: Uint32Array.from(this.indices), vertexCount: count };
  }
}
