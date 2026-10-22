import { describe, expect, it } from 'vitest';
import { AutoSpotter, MAX_DEFLECTION_CORRECTION, MAX_RANGE_CORRECTION, reportSalvo } from '../src/sim/gunnery/spotting';

/**
 * The spotter's loop with the delay real shells have: a salvo is fired under the corrections standing then and called
 * `delay` salvos later, by which time more corrections have been made.
 */
function run(delay: number, trueError: number, gain?: number): number[] {
  const spotter = new AutoSpotter();
  const inFlight: { fell: number; firedWith: { range: number; deflection: number } }[] = [];
  const history: number[] = [];
  for (let n = 0; n < 40; n++) {
    // The salvo lands where the guns' true error plus the corrections they were laid with put it.
    const firedWith = { range: spotter.range, deflection: spotter.deflection };
    inFlight.push({ fell: trueError + firedWith.range, firedWith });
    if (inFlight.length > delay) {
      const s = inFlight.shift()!;
      // Two shells either side of the mean, so the call is a straddle or one-sided as the mean says.
      const report = reportSalvo(n, [s.fell - 20, s.fell + 20].map((range) => ({ range, deflection: 0, hit: false })));
      if (gain === undefined) spotter.apply(report, s.firedWith);
      else spotter.apply(report);
    }
    history.push(trueError + spotter.range);
  }
  return history;
}

describe('the auto-spotter with shells in the air', () => {
  it('settles on a steady error with three salvos in flight, without ringing', () => {
    const miss = run(3, 400);
    // By the end it is within a straddle's width, and it never swung far past zero on the way.
    expect(Math.abs(miss[miss.length - 1]!)).toBeLessThan(40);
    expect(Math.min(...miss)).toBeGreaterThan(-150);
  });

  it('the old way (correcting from what the corrections are now) rings when salvos are delayed', () => {
    const miss = run(3, 400, 0);
    // Without the delay compensation it overshoots badly: that is what ran the 12-pounders into the weeds.
    expect(Math.min(...miss)).toBeLessThan(-300);
  });

  it('is bounded: wild falls cannot drive the corrections out of the sane band', () => {
    const s = new AutoSpotter();
    for (let i = 0; i < 20; i++) {
      s.apply(reportSalvo(i, [{ range: -9000, deflection: 9000, hit: false }]));
    }
    expect(Math.abs(s.range)).toBeLessThanOrEqual(MAX_RANGE_CORRECTION);
    expect(Math.abs(s.deflection)).toBeLessThanOrEqual(MAX_DEFLECTION_CORRECTION);
  });

  it('does not undo the player\'s own correction: it takes the manual part out of what it adds', () => {
    const s = new AutoSpotter();
    // The player has dialled +200 m; the guns, so laid, fall 100 m beyond the target: they want 100 m less in all.
    s.apply(reportSalvo(1, [{ range: 100, deflection: 0, hit: false }]), { range: 200, deflection: 0 }, { range: 200, deflection: 0 });
    // Total wanted = 200 - 100 = 100; the player supplies 200, so the spotter's share is -100 (at its gain).
    expect(s.range).toBeLessThan(0);
    expect(s.range).toBeGreaterThan(-100.001);
  });
});
