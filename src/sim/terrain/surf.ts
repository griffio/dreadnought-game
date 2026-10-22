import { VertexSink, KIND_TRAIL } from '../ships/wake';
import type { Terrain } from './terrain';

/** Metres across the band of white water along a shore. */
const BAND = 18;

/**
 * The surf along every shore, as foam ribbons for the wake renderer to draw. The coastline is cut once into short segments with
 * the direction of the open sea at each; every frame the ones within sight are written out, the foam breathing with the swell.
 */
export class SurfLines {
  /** Per segment: midpoint x, z, tangent x, z, seaward normal x, z, half length, phase. */
  private readonly data: Float32Array;
  readonly count: number;

  constructor(terrain: Terrain) {
    const segs = terrain.coast(0.2);
    this.count = segs.length;
    this.data = new Float32Array(segs.length * 8);
    segs.forEach((s, i) => {
      const mx = (s[0] + s[2]) / 2;
      const mz = (s[1] + s[3]) / 2;
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1;
      // The sea lies where the ground is lower: the seaward direction is down the slope.
      const e = terrain.cell;
      let nx = terrain.heightAt(mx - e, mz) - terrain.heightAt(mx + e, mz);
      let nz = terrain.heightAt(mx, mz - e) - terrain.heightAt(mx, mz + e);
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const o = i * 8;
      this.data[o] = mx;
      this.data[o + 1] = mz;
      this.data[o + 2] = (s[2] - s[0]) / len;
      this.data[o + 3] = (s[3] - s[1]) / len;
      this.data[o + 4] = nx;
      this.data[o + 5] = nz;
      this.data[o + 6] = len / 2 + 1.5;
      this.data[o + 7] = ((i * 2654435761) >>> 0) / 4294967296;
    });
  }

  /** Write the surf within `range` metres of (camX, camZ) into the ribbon buffer. */
  emit(sink: VertexSink, camX: number, camZ: number, range: number, time: number): void {
    const r2 = range * range;
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const o = i * 8;
      const mx = d[o]!;
      const mz = d[o + 1]!;
      const dx = mx - camX;
      const dz = mz - camZ;
      if (dx * dx + dz * dz > r2) continue;
      const tx = d[o + 2]!;
      const tz = d[o + 3]!;
      const nx = d[o + 4]!;
      const nz = d[o + 5]!;
      const half = d[o + 6]!;
      const phase = d[o + 7]!;
      // The foam waxes and wanes as the swell breaks, and lies mostly seaward of the line where the water meets the land.
      const foam = 0.62 + 0.3 * Math.sin(time * 0.8 + phase * 6.28) * (0.5 + 0.5 * phase);
      const cx = mx + nx * BAND * 0.2;
      const cz = mz + nz * BAND * 0.2;
      const hx = nx * BAND * 0.5;
      const hz = nz * BAND * 0.5;
      const ax = tx * half;
      const az = tz * half;
      // Two triangles: (a-, a+, b-), (b-, a+, b+): `across` runs -1 on the land side to +1 on the sea side.
      const lx = cx - hx;
      const lz = cz - hz;
      const sx = cx + hx;
      const sz = cz + hz;
      sink.push(lx - ax, lz - az, -1, foam, KIND_TRAIL);
      sink.push(sx - ax, sz - az, 1, foam, KIND_TRAIL);
      sink.push(lx + ax, lz + az, -1, foam, KIND_TRAIL);
      sink.push(lx + ax, lz + az, -1, foam, KIND_TRAIL);
      sink.push(sx - ax, sz - az, 1, foam, KIND_TRAIL);
      sink.push(sx + ax, sz + az, 1, foam, KIND_TRAIL);
    }
  }
}
