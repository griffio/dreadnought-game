/**
 * Dazzle paint: the angular patches that broke up a ship's lines from 1917. They did not hide her. They made it hard to judge which
 * way she was heading and how fast, and so how far she would travel before the shells fell. The effect is a coarser reading of her:
 * the range read off the rangefinder and the bearing both wander more, and it does so more the further off she is, because the
 * pattern is lost at close range. Inside about three kilometres it does nothing; by nine it is all there is.
 */
const NEAR = 3000;
const FAR = 9000;
/** At full strength and long range: how much worse the range reading is, and the bearing. */
const RANGE_PENALTY = 0.35;
const BEARING_PENALTY = 0.6;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Multipliers on the error of a range reading and of a bearing reading taken of a ship painted with `strength` (0..1) at `range` metres. */
export function dazzleFactor(strength: number, range: number): { range: number; bearing: number } {
  const k = Math.min(Math.max(strength, 0), 1) * smooth(NEAR, FAR, range);
  return { range: 1 + RANGE_PENALTY * k, bearing: 1 + BEARING_PENALTY * k };
}
