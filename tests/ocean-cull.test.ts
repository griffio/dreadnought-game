import { describe, expect, it } from 'vitest';
import { arcContains, visibleArc, type ArcView } from '../src/render/ocean/ocean-cull';

const DEG = Math.PI / 180;
const SEGS = 384;

/** A camera at `yawDeg`/`pitchDeg` in the game's convention (yaw 0 north = -z, 90 east = +x), 60 degrees of vertical field at 16:9. */
function view(yawDeg: number, pitchDeg: number, over: Partial<ArcView> = {}): ArcView {
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  return {
    forward: [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)],
    tanHalfFovY: Math.tan(30 * DEG),
    aspect: 16 / 9,
    cameraHeight: 28,
    waveAmplitude: 3,
    maxSideways: 5,
    innerRadius: 18,
    segments: SEGS,
    ...over,
  };
}

/** The grid segment the forward direction points along: a vertex sits at (cos a, sin a) * r in camera-relative (x, z). */
function forwardSegment(v: ArcView): number {
  const a = Math.atan2(v.forward[2], v.forward[0]);
  return Math.floor((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / SEGS));
}

describe('the arc of the sea in view', () => {
  it('a level view takes a wide wedge about the forward direction, well short of the circle', () => {
    for (const yaw of [0, 70, 250, 359]) {
      const v = view(yaw, 3);
      const arc = visibleArc(v);
      expect(arc.count).toBeGreaterThan(SEGS * 0.3);
      expect(arc.count).toBeLessThan(SEGS * 0.55);
      expect(arcContains(arc, forwardSegment(v), SEGS)).toBe(true);
      // Symmetric about the forward direction, to a segment.
      const mid = (arc.from + arc.count / 2) % SEGS;
      const diff = Math.abs(((mid - forwardSegment(v) + SEGS * 1.5) % SEGS) - SEGS / 2);
      expect(diff).toBeLessThanOrEqual(1.5);
    }
  });

  it('wraps past the last segment when the view straddles it', () => {
    // Forward along +x is the grid's angle 0: the wedge runs from the end of the circle round to its start.
    const v = view(90, 3);
    const arc = visibleArc(v);
    expect(arc.from).toBeGreaterThan(SEGS / 2);
    expect(arc.from + arc.count).toBeGreaterThan(SEGS);
    expect(arcContains(arc, 0, SEGS)).toBe(true);
    expect(arcContains(arc, SEGS - 1, SEGS)).toBe(true);
    expect(arcContains(arc, SEGS / 2, SEGS)).toBe(false);
  });

  it('looking down takes the whole circle, and looking at the sky none of it', () => {
    expect(visibleArc(view(120, -89)).count).toBe(SEGS);
    expect(visibleArc(view(120, -75)).count).toBe(SEGS);
    // Half-way down the frustum still does not reach behind the camera.
    const half = visibleArc(view(120, -45)).count;
    expect(half).toBeGreaterThan(SEGS * 0.5);
    expect(half).toBeLessThan(SEGS);
    expect(visibleArc(view(120, 80)).count).toBe(0);
    // Sixty degrees up still has the horizon along the bottom of the frame.
    expect(visibleArc(view(120, 60)).count).toBeGreaterThan(0);
  });

  it('a narrow field of view (the director\'s sight zoomed in) takes a narrower wedge', () => {
    const wide = visibleArc(view(30, 1)).count;
    const narrow = visibleArc(view(30, 1, { tanHalfFovY: Math.tan(4 * DEG) })).count;
    expect(narrow).toBeLessThan(wide * 0.6);
    expect(narrow).toBeGreaterThan(0);
  });

  it('a camera down at the water sees more of the circle than one up in the foretop', () => {
    const high = visibleArc(view(30, -3)).count;
    const low = visibleArc(view(30, -3, { cameraHeight: 2 })).count;
    expect(low).toBeGreaterThanOrEqual(high);
  });
});
