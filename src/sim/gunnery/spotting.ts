/**
 * Fall of shot: where each shell of a salvo landed relative to the target, the spotter's call, and the bracketing
 * corrector that turns those calls into range and deflection corrections.
 */
export interface ShellFall {
  /** Metres beyond (+) or short of (-) the target along the line from the firing ship. */
  range: number;
  /** Metres to the right (+) or left (-) of that line. */
  deflection: number;
  hit: boolean;
}

export type SpotCall = 'HIT' | 'STRADDLE' | 'SHORT' | 'OVER';

export interface SalvoReport {
  salvo: number;
  shells: ShellFall[];
  hits: number;
  meanRange: number;
  meanDeflection: number;
  call: SpotCall;
  /** "OVER 240, LEFT 30" style text for the HUD. */
  text: string;
}

/** Where a splash or hit lies relative to the target as seen from the firing ship. */
export function fallRelativeToTarget(
  ownX: number,
  ownZ: number,
  targetX: number,
  targetZ: number,
  fallX: number,
  fallZ: number,
  hit: boolean,
): ShellFall {
  const lx = targetX - ownX;
  const lz = targetZ - ownZ;
  const l = Math.hypot(lx, lz) || 1;
  const ux = lx / l;
  const uz = lz / l;
  const dx = fallX - targetX;
  const dz = fallZ - targetZ;
  return {
    range: dx * ux + dz * uz,
    // Right of the line of fire is (-uz, ux) in (x, z).
    deflection: -dx * uz + dz * ux,
    hit,
  };
}

export function reportSalvo(salvo: number, shells: ShellFall[]): SalvoReport {
  const n = Math.max(shells.length, 1);
  const hits = shells.filter((s) => s.hit).length;
  const meanRange = shells.reduce((a, s) => a + s.range, 0) / n;
  const meanDeflection = shells.reduce((a, s) => a + s.deflection, 0) / n;
  const short = shells.filter((s) => s.range < 0).length;
  const over = shells.length - short;
  let call: SpotCall;
  if (hits > 0) call = 'HIT';
  else if (short > 0 && over > 0) call = 'STRADDLE';
  else call = short > 0 ? 'SHORT' : 'OVER';
  const side = meanDeflection >= 0 ? 'RIGHT' : 'LEFT';
  const along = `${meanRange >= 0 ? 'OVER' : 'SHORT'} ${Math.round(Math.abs(meanRange) / 10) * 10}`;
  const across = `${side} ${Math.round(Math.abs(meanDeflection) / 5) * 5}`;
  // A one-sided salvo is called by its fall; a straddle by where the group's centre lay.
  const text =
    call === 'HIT' ? `HIT x${hits}` : call === 'STRADDLE' ? `STRADDLE (${along}, ${across})` : `${along}, ${across}`;
  return { salvo, shells, hits, meanRange, meanDeflection, call, text };
}

/**
 * Bracketing corrector. After each salvo it moves the range correction toward the observed mean fall: boldly when every
 * shell fell on one side (the target is not yet bracketed), by about half when the salvo straddled (the target is
 * inside the group, so refine), and not at all when it hit.
 */
export class AutoSpotter {
  range = 0;
  deflection = 0;

  reset(): void {
    this.range = 0;
    this.deflection = 0;
  }

  /**
   * Move the corrections toward the salvo's observed fall. Shells take twenty seconds or more to land, so several salvos are in
   * the air when the first is called, and each has been fired under whatever corrections stood then. What a salvo measured is
   * the guns' true error plus those corrections, so `firedWith` (the total standing when it was fired) is taken back out:
   * without that each report corrects for an error the corrections since have already removed, and the loop overshoots and
   * rings. `manual` is the part of the total that is not the spotter's.
   */
  apply(report: SalvoReport, firedWith?: Correction, manual: Correction = ZERO): void {
    const total = firedWith ?? { range: this.range + manual.range, deflection: this.deflection + manual.deflection };
    // The total that would have put this salvo's mean on the target, less the part that is the player's own.
    const wantRange = total.range - report.meanRange - manual.range;
    const wantDeflection = total.deflection - report.meanDeflection - manual.deflection;
    let gainRange: number;
    let gainDeflection: number;
    if (report.call === 'HIT') {
      // Keep what works, but nudge toward the centre of the group.
      gainRange = 0.35;
      gainDeflection = 0.35;
    } else {
      gainRange = report.call === 'STRADDLE' ? 0.5 : 0.95;
      // A deflection error that is real (a wrong course or speed in the plot) comes back each salvo; one that is chasing a
      // target that has since turned does not. A moderate gain keeps a spotter that is wrong from swinging wider each time.
      gainDeflection = 0.6;
    }
    this.range += (clamp(wantRange, -MAX_RANGE_CORRECTION, MAX_RANGE_CORRECTION) - this.range) * gainRange;
    this.deflection += (clamp(wantDeflection, -MAX_DEFLECTION_CORRECTION, MAX_DEFLECTION_CORRECTION) - this.deflection) * gainDeflection;
  }
}

export interface Correction {
  range: number;
  deflection: number;
}

const ZERO: Correction = { range: 0, deflection: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(Math.min(v, hi), lo);
}

/** The most the spotter will ever correct by, metres. */
export const MAX_RANGE_CORRECTION = 1500;
export const MAX_DEFLECTION_CORRECTION = 400;
