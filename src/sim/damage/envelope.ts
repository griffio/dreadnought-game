import { rangeAtElevation, solveElevation, type ShellSpec } from '../gunnery/ballistics';
import type { ArmorSpec } from './spec';
import { throughPlate } from './penetration';

export interface EnvelopeBand {
  range: number;
  /** Can a shell fired from this range, striking square, get through the waterline belt, the upper side, the deck? */
  belt: boolean;
  upper: boolean;
  deck: boolean;
}

export interface Envelope {
  bands: EnvelopeBand[];
  /** Longest range the guns reach at full elevation, metres. */
  reach: number;
}

/**
 * Where a gun can hurt an armoured ship: for each range, the speed and angle a shell arrives at, and which layers of
 * armour it defeats. A broadside shot meets the belt and the side at the cosine of its descent angle (nearly square at
 * moderate range) and the deck at the sine of it (glancing, until the range is long enough for a steep fall).
 */
export function penetrationEnvelope(
  shell: ShellSpec,
  maxElevation: number,
  muzzleHeight: number,
  armor: ArmorSpec,
  from = 2000,
  to = 20000,
  step = 500,
): Envelope {
  const bands: EnvelopeBand[] = [];
  const reach = rangeAtElevation(shell, maxElevation, muzzleHeight)?.range ?? 0;
  const mm = shell.diameterM * 1000;
  for (let range = from; range <= to; range += step) {
    const el = range <= reach ? solveElevation(shell, range, maxElevation, muzzleHeight) : null;
    const arrival = el === null ? null : rangeAtElevation(shell, el, muzzleHeight);
    if (!arrival) {
      bands.push({ range, belt: false, upper: false, deck: false });
      continue;
    }
    const a = (arrival.angleDeg * Math.PI) / 180;
    const through = (plate: number, cos: number) => throughPlate(arrival.speed, shell.massKg, mm, plate, cos).outcome === 'penetrate';
    bands.push({
      range,
      belt: through(armor.belt.mm, Math.cos(a)),
      upper: through(armor.upperSide.mm, Math.cos(a)),
      deck: through(armor.deck.mm, Math.sin(a)),
    });
  }
  return { bands, reach };
}
