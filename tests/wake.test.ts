import { describe, expect, it } from 'vitest';
import {
  buildHullFoam,
  buildWake,
  emitRibbon,
  KELVIN_TAN,
  VertexSink,
  WAKE_FLOATS_PER_VERTEX,
  WakeHistory,
} from '../src/sim/ships/wake';

const ship = { beam: 25, referenceSpeed: 10.8 };

/** A ship that sailed east along z = 0 from x = 0 at 10 m/s for `seconds`, stern positions sampled each metre. */
function straightHistory(seconds: number, speed = 10): WakeHistory {
  const h = new WakeHistory();
  for (let t = 0; t <= seconds; t += 0.1) h.record(speed * t, 0, t, speed, 0.8);
  return h;
}

const vertices = (sink: VertexSink) =>
  Array.from({ length: sink.count }, (_, i) => {
    const o = i * WAKE_FLOATS_PER_VERTEX;
    return { x: sink.data[o]!, z: sink.data[o + 1]!, across: sink.data[o + 2]!, foam: sink.data[o + 3]!, kind: sink.data[o + 4]! };
  });

describe('WakeHistory', () => {
  it('records a sample per spacing of travel, none while stationary', () => {
    const h = new WakeHistory(1.6);
    for (let t = 0; t <= 2; t += 0.1) h.record(5 * t, 0, t, 5, 0.5); // 10 m in 2 s
    // 10 m of travel in 0.5 m steps with a 1.6 m spacing: a sample every 2 m.
    expect(h.samples.length).toBeGreaterThanOrEqual(5);
    expect(h.samples.length).toBeLessThanOrEqual(7);
    const still = new WakeHistory();
    for (let t = 0; t < 5; t += 0.1) still.record(0, 0, t, 0, 0);
    expect(still.samples).toHaveLength(0);
  });

  it('drops samples older than the maximum age', () => {
    const h = straightHistory(200);
    const oldest = h.samples[0]!;
    expect(200 - oldest.t).toBeLessThanOrEqual(110.5);
    expect(h.samples.length).toBeGreaterThan(100);
  });
});

describe('buildWake', () => {
  const big = () => new VertexSink(new Float32Array(60000 * WAKE_FLOATS_PER_VERTEX));

  it('emits ribbons for a moving ship and nothing for a short history', () => {
    const sink = big();
    buildWake(sink, straightHistory(0.05), 0.05, ship);
    expect(sink.count).toBe(0);
    sink.reset();
    buildWake(sink, straightHistory(60), 60, ship);
    expect(sink.count).toBeGreaterThan(300);
    expect(sink.count % 3).toBe(0);
  });

  it('widens with age and is symmetric about the track', () => {
    const sink = big();
    const h = straightHistory(60);
    buildWake(sink, h, 60, ship);
    const edges = vertices(sink).filter((p) => Math.abs(p.across) === 1);
    const widthNear = (x: number) => {
      const zs = edges.filter((p) => Math.abs(p.x - x) < 9).map((p) => p.z);
      return { span: Math.max(...zs) - Math.min(...zs), mid: (Math.max(...zs) + Math.min(...zs)) / 2 };
    };
    const old = widthNear(h.samples[10]!.x);
    const young = widthNear(h.samples[h.samples.length - 5]!.x);
    expect(old.span).toBeGreaterThan(young.span * 1.5);
    expect(Math.abs(old.mid)).toBeLessThan(1e-3);
    expect(Math.abs(young.mid)).toBeLessThan(1e-3);
  });

  it('foam is strongest right behind the stern and fades with age', () => {
    const sink = big();
    const h = straightHistory(80);
    buildWake(sink, h, 80, ship);
    const newest = h.samples[h.samples.length - 1]!.x;
    const oldest = h.samples[0]!.x;
    const v = vertices(sink);
    const foamNear = Math.max(...v.filter((p) => p.x > newest - 10).map((p) => p.foam));
    const foamFar = Math.max(...v.filter((p) => p.x < oldest + 15).map((p) => p.foam));
    expect(foamNear).toBeGreaterThan(0.8);
    expect(foamFar).toBeLessThan(foamNear * 0.4);
  });

  it('Kelvin lines spread at 19.5 degrees: lateral offset is 0.354 of the distance behind', () => {
    const sink = big();
    const h = straightHistory(40);
    buildWake(sink, h, 40, ship, true);
    const kelvin = vertices(sink).filter((p) => p.kind === 1);
    const newest = h.samples[h.samples.length - 1]!;
    // At a given distance behind the stern, each line's vertices straddle its centre, so their mean lateral
    // position (one line at a time, split by side of the track) is the line's offset.
    for (const behind of [60, 120, 190]) {
      const near = kelvin.filter((p) => Math.abs(newest.x - p.x - behind) < 4);
      for (const side of [1, -1]) {
        const zs = near.filter((p) => Math.sign(p.z) === side).map((p) => p.z);
        expect(zs.length).toBeGreaterThan(0);
        const centre = Math.abs(zs.reduce((a, z) => a + z, 0) / zs.length);
        expect(centre / behind).toBeCloseTo(KELVIN_TAN, 1);
      }
    }
  });

  it('never overflows its buffer', () => {
    const sink = new VertexSink(new Float32Array(120 * WAKE_FLOATS_PER_VERTEX));
    buildWake(sink, straightHistory(90), 90, ship);
    expect(sink.count).toBeLessThanOrEqual(120);
  });

  it('stays within a small vertex budget for a full 110 s history', () => {
    const sink = big();
    buildWake(sink, straightHistory(120), 120, ship);
    expect(sink.count).toBeLessThan(12000);
    expect(sink.count).toBeGreaterThan(500);
  });
});

describe('Kelvin lines are optional', () => {
  const big = () => new VertexSink(new Float32Array(60000 * WAKE_FLOATS_PER_VERTEX));

  it('are not emitted by default', () => {
    const off = big();
    const on = big();
    const h = straightHistory(40);
    buildWake(off, h, 40, ship);
    buildWake(on, h, 40, ship, true);
    expect(on.count).toBeGreaterThan(off.count);
    expect(vertices(off).every((p) => p.kind === 0)).toBe(true);
    expect(vertices(on).some((p) => p.kind === 1)).toBe(true);
  });

  it('the trail stays visible for a long way: still strong after 200 m of travel', () => {
    const sink = big();
    const h = straightHistory(60);
    buildWake(sink, h, 60, ship);
    const newest = h.samples[h.samples.length - 1]!;
    const v = vertices(sink).filter((p) => newest.x - p.x > 185 && newest.x - p.x < 215);
    expect(v.length).toBeGreaterThan(0);
    // 200 m at 10 m/s is 20 s old: should still be a clearly visible foam level.
    expect(Math.max(...v.map((p) => p.foam))).toBeGreaterThan(0.35);
  });
});

describe('wake vertex kinds', () => {
  it('the trail comes first as kind 0, then the Kelvin lines as kind 1', () => {
    const trailOnly = new VertexSink(new Float32Array(60000 * WAKE_FLOATS_PER_VERTEX));
    const all = new VertexSink(new Float32Array(60000 * WAKE_FLOATS_PER_VERTEX));
    const h = straightHistory(40);
    buildWake(trailOnly, h, 40, ship);
    buildWake(all, h, 40, ship, true);
    const v = vertices(all);
    expect(v.slice(0, trailOnly.count).every((p) => p.kind === 0)).toBe(true);
    expect(v.slice(trailOnly.count).every((p) => p.kind === 1)).toBe(true);
    // The Kelvin lines carry real strength (they are drawn at reduced opacity by the shader).
    expect(Math.max(...v.slice(trailOnly.count).map((p) => p.foam))).toBeGreaterThan(0.3);
  });

  it('hull foam is trail kind', () => {
    const sink = new VertexSink(new Float32Array(4000 * WAKE_FLOATS_PER_VERTEX));
    buildHullFoam(sink, 0, 0, 0, { length: 160, halfBreadthAt: () => 12, speedFraction: 1 });
    expect(vertices(sink).every((p) => p.kind === 0)).toBe(true);
  });
});

describe('buildHullFoam', () => {
  const hull = { length: 160, halfBreadthAt: (x: number) => 12.5 * Math.max(0, 1 - Math.pow(Math.max(x / 80, 0), 2)), speedFraction: 1 };

  it('does nothing at rest', () => {
    const sink = new VertexSink(new Float32Array(4000 * WAKE_FLOATS_PER_VERTEX));
    buildHullFoam(sink, 0, 0, 90, { ...hull, speedFraction: 0 });
    expect(sink.count).toBe(0);
  });

  it('is mirrored port and starboard and strongest at the bow', () => {
    const sink = new VertexSink(new Float32Array(4000 * WAKE_FLOATS_PER_VERTEX));
    buildHullFoam(sink, 0, 0, 90, hull); // heading east: bow toward +x, starboard toward +z
    const v = vertices(sink);
    expect(v.length).toBeGreaterThan(100);
    const sbZ = v.filter((p) => p.z > 0 && p.across === -1).map((p) => p.z);
    const portZ = v.filter((p) => p.z < 0 && p.across === -1).map((p) => p.z);
    expect(sbZ.length).toBeGreaterThan(0);
    expect(portZ.length).toBeGreaterThan(0);
    const bowFoam = Math.max(...v.filter((p) => p.x > 60).map((p) => p.foam));
    const midFoam = Math.max(...v.filter((p) => Math.abs(p.x) < 10).map((p) => p.foam));
    expect(bowFoam).toBeGreaterThan(midFoam * 1.6);
    expect(Math.max(...v.map((p) => p.x))).toBeGreaterThan(80); // reaches the stem
  });

  it('scales with speed', () => {
    const slow = new VertexSink(new Float32Array(4000 * WAKE_FLOATS_PER_VERTEX));
    const fast = new VertexSink(new Float32Array(4000 * WAKE_FLOATS_PER_VERTEX));
    buildHullFoam(slow, 0, 0, 0, { ...hull, speedFraction: 0.3 });
    buildHullFoam(fast, 0, 0, 0, { ...hull, speedFraction: 1 });
    const peak = (s: VertexSink) => Math.max(...vertices(s).map((p) => p.foam));
    expect(peak(fast)).toBeGreaterThan(peak(slow) * 1.8);
  });
});

describe('emitRibbon', () => {
  const small = () => new VertexSink(new Float32Array(20000 * WAKE_FLOATS_PER_VERTEX));

  it('a narrow ribbon between two points is split into strips no wider than the limit', () => {
    const sink = small();
    emitRibbon(sink, [
      { x: 0, z: 0, halfWidth: 3, foam: 1 },
      { x: 10, z: 0, halfWidth: 3, foam: 1 },
    ]);
    // 6 m wide with 5 m strips: two strips, two triangles each, three vertices per triangle.
    expect(sink.count).toBe(12);
    const zs = vertices(sink).map((v) => v.z);
    expect(Math.max(...zs)).toBeCloseTo(3, 6);
    expect(Math.min(...zs)).toBeCloseTo(-3, 6);
  });

  it('a wide ribbon is subdivided across its width so it can follow a swell', () => {
    const sink = small();
    emitRibbon(sink, [
      { x: 0, z: 0, halfWidth: 20, foam: 1 },
      { x: 10, z: 0, halfWidth: 20, foam: 1 },
    ]);
    expect(sink.count).toBe(8 * 6); // 40 m across / 5 m strips
    const across = new Set(vertices(sink).map((v) => v.across.toFixed(3)));
    expect(across.size).toBe(9);
  });

  it('thins the path where the ribbon is wide, keeps it fine where it is narrow', () => {
    const wide = small();
    const narrow = small();
    const line = (hw: number) => Array.from({ length: 100 }, (_, i) => ({ x: i * 1.6, z: 0, halfWidth: hw, foam: 1 }));
    emitRibbon(wide, line(20));
    emitRibbon(narrow, line(1));
    const perSegmentWide = 8 * 6;
    const perSegmentNarrow = 1 * 6;
    expect(wide.count / perSegmentWide).toBeLessThan(25);
    expect(narrow.count / perSegmentNarrow).toBeGreaterThan(90);
  });

  it('keeps both end points of the path', () => {
    const sink = small();
    emitRibbon(
      sink,
      Array.from({ length: 50 }, (_, i) => ({ x: i * 2, z: 0, halfWidth: 12, foam: 1 })),
    );
    const xs = vertices(sink).map((v) => v.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(98, 6);
  });
});
