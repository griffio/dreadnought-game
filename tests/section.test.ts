import { describe, expect, it } from 'vitest';
import { BREAK_PITCH, BREAK_ROLL, SUNK_DROP_M, carry, sectionMatrix } from '../src/render/ships/section';

const CUT = 20;
const mat = (side: 1 | -1, age: number, sunk = 0): Float32Array => sectionMatrix(side, CUT, age, sunk, new Float32Array(16));
const at = (m: Float32Array, p: [number, number, number]) => carry(m, p);

describe('the halves of a ship broken in two', () => {
  it('are in their places at the moment she breaks', () => {
    for (const side of [1, -1] as const) {
      const m = mat(side, 0);
      for (const p of [[CUT + 50, 3, 4], [CUT - 50, 6, -8], [CUT, 0, 0]] as [number, number, number][]) {
        const q = at(m, p);
        expect(q[0]).toBeCloseTo(p[0], 5);
        expect(q[1]).toBeCloseTo(p[1], 5);
        expect(q[2]).toBeCloseTo(p[2], 5);
      }
    }
  });

  it('tip about the break, each far end rising and the break itself staying where it was', () => {
    const bow = mat(1, 30);
    const stern = mat(-1, 30);
    const bowTip = at(bow, [CUT + 70, 0, 0]);
    const sternTip = at(stern, [CUT - 70, 0, 0]);
    // The ends rise by 70 sin(30 degrees) or so (a little less for the roll), and come in a little as they tip.
    const rise = 70 * Math.sin(BREAK_PITCH) * Math.cos(BREAK_ROLL);
    expect(bowTip[1]).toBeGreaterThan(rise * 0.97);
    expect(sternTip[1]).toBeGreaterThan(rise * 0.97);
    // (It swings about the break, so it stays 70 m from it.)
    const pivot = at(bow, [CUT, 0, 0]);
    expect(Math.hypot(bowTip[0] - pivot[0], bowTip[1] - pivot[1], bowTip[2] - pivot[2])).toBeCloseTo(70, 4);
    // The break stays at the surface and does not rise: it only moves apart from its partner.
    expect(at(bow, [CUT, 0, 0])[1]).toBeCloseTo(0, 5);
    expect(at(stern, [CUT, 0, 0])[1]).toBeCloseTo(0, 5);
  });

  it('draw apart a few metres, in opposite directions', () => {
    const bow = at(mat(1, 60), [CUT, 0, 0]);
    const stern = at(mat(-1, 60), [CUT, 0, 0]);
    expect(bow[0] - CUT).toBeGreaterThan(5);
    expect(CUT - stern[0]).toBeGreaterThan(5);
    expect(bow[0] - CUT).toBeLessThan(12);
  });

  it('roll the opposite ways, a little', () => {
    const bow = at(mat(1, 60), [CUT, 0, 10]);
    const stern = at(mat(-1, 60), [CUT, 0, 10]);
    expect(Math.sign(bow[1])).toBe(-Math.sign(stern[1]));
    expect(Math.abs(bow[1])).toBeCloseTo(10 * Math.sin(BREAK_ROLL), 0);
  });

  it('settle into that over some seconds, not at once', () => {
    const early = at(mat(1, 1), [CUT + 70, 0, 0])[1];
    const later = at(mat(1, 8), [CUT + 70, 0, 0])[1];
    const late = at(mat(1, 40), [CUT + 70, 0, 0])[1];
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(later);
    expect(later).toBeLessThan(late);
    expect(late).toBeLessThan(70 * Math.sin(BREAK_PITCH) * 1.01);
  });

  it('go down into the sea as she is declared sunk, far enough that nothing is left to show', () => {
    const down = at(mat(1, 40, 1), [CUT + 70, 0, 0]);
    const up = at(mat(1, 40, 0), [CUT + 70, 0, 0]);
    expect(up[1] - down[1]).toBeCloseTo(SUNK_DROP_M, 3);
    // Even the highest point of the far end, 70 m out and 30 m up the mast, is under.
    expect(at(mat(1, 40, 1), [CUT + 70, 30, 0])[1]).toBeLessThan(0);
    expect(at(mat(-1, 40, 1), [CUT - 70, 30, 0])[1]).toBeLessThan(0);
    // The sinking is clamped, so that a late frame cannot send her to the bottom of the sea.
    expect(at(mat(1, 40, 50), [CUT, 0, 0])[1]).toBeGreaterThan(-SUNK_DROP_M * 1.3);
  });

  it('are the same for the same age (a replay lays them as they were)', () => {
    expect(Array.from(mat(-1, 12.5, 0.4))).toEqual(Array.from(mat(-1, 12.5, 0.4)));
  });

  it('keep their lengths: no half is stretched or squashed', () => {
    const m = mat(1, 25, 0.3);
    const a = at(m, [CUT + 10, 2, 3]);
    const b = at(m, [CUT + 50, 7, -5]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(Math.hypot(40, 5, 8), 4);
  });
});
