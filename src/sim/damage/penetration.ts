/**
 * Armour penetration, in the manner of Jacob de Marre: the thickness a shell can defeat grows with its speed to about the
 * 1.4 power and with its mass, and falls with its calibre. The constant is calibrated against one reference shell, the
 * 12"/45 Mk X armour-piercing round, which defeats about 380 mm of face-hardened plate at point-blank range, roughly 245 mm
 * at 5 km and 170 mm at 10 km. Treat the figures as accurate to the 10% or so the published tables allow.
 */
export const REFERENCE_SHELL = { massKg: 386, diameterMm: 305, speed: 823, penetrationMm: 380 } as const;

/** Plates thinner than this do not make an armour-piercing fuze function: the shell goes through. */
export const FUZE_TRIGGER_MM = 30;
/** Seconds the base fuze delays the burst after the shell has gone through a plate that triggers it (a short delay, as in a common shell). */
export const FUZE_DELAY_SECONDS = 0.015;
/** An impact-fuzed shell bursts on any plate of at least this thickness, a metre or so inside it. */
export const IMPACT_TRIGGER_MM = 6;
export const IMPACT_DELAY_SECONDS = 0.002;
/** A shell striking a plate at more than about 74 degrees from its normal glances off. */
export const RICOCHET_COS = 0.28;

/** Thickness of face-hardened plate, mm, a shell defeats at normal incidence at `speed` m/s. */
export function penetrationMm(massKg: number, diameterMm: number, speed: number): number {
  const r = REFERENCE_SHELL;
  return (
    r.penetrationMm *
    Math.pow(Math.max(speed, 0) / r.speed, 1.43) *
    Math.pow(massKg / r.massKg, 0.71) *
    Math.pow(r.diameterMm / diameterMm, 1.07)
  );
}

export type PlateOutcome = 'penetrate' | 'shatter' | 'ricochet';

export interface PlateResult {
  outcome: PlateOutcome;
  /** Plate thickness as the shell meets it, mm (thickness over the cosine of the obliquity). */
  effectiveMm: number;
  /** Speed after the plate, m/s (the speed it arrived at when it did not get through). */
  speed: number;
}

/**
 * A shell meets a plate. `cosTheta` is the cosine of the angle between the shell's path and the plate's normal: 1 is
 * square on, small is a glancing blow. `armour` scales what the shell can defeat (1 for an armour-piercing shell).
 */
export function throughPlate(speed: number, massKg: number, diameterMm: number, plateMm: number, cosTheta: number, armour = 1): PlateResult {
  if (plateMm < FUZE_TRIGGER_MM) {
    // Light structure: the shell loses a little speed and carries on.
    return { outcome: 'penetrate', effectiveMm: plateMm, speed: speed * (1 - 0.0006 * plateMm) };
  }
  const c = Math.abs(cosTheta);
  const effectiveMm = plateMm / Math.max(c, 0.05);
  if (c < RICOCHET_COS) return { outcome: 'ricochet', effectiveMm, speed };
  const capacity = penetrationMm(massKg, diameterMm, speed) * armour;
  if (capacity < effectiveMm) return { outcome: 'shatter', effectiveMm, speed };
  // Energy spent getting through: nothing when the plate is a small fraction of what the shell could do, nearly all of it at the limit.
  const spent = 0.85 * Math.pow(effectiveMm / capacity, 2);
  return { outcome: 'penetrate', effectiveMm, speed: speed * Math.sqrt(Math.max(1 - spent, 0.05)) };
}

/** Longest range at which a shell fired at `speedAt(range)` still defeats `plateMm` square on (helper for the envelope display). */
export function canDefeat(massKg: number, diameterMm: number, speed: number, plateMm: number, cosTheta: number, armour = 1): boolean {
  return throughPlate(speed, massKg, diameterMm, plateMm, cosTheta, armour).outcome === 'penetrate';
}
