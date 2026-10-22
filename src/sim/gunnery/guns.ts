import type { ShellSpec } from './ballistics';

/**
 * Gun data. Figures are the published ones rounded, and the drag form factor is calibrated against published range
 * tables: the 12"/45 Mk X reaches about 25,000 yd at 30 degrees with the blunt capped shell of its day; the 15"/42
 * reaches about 30,000 yd at 30 degrees with the pre-Jutland shell. Treat ranges as accurate to roughly 10%.
 */
export interface GunSpec {
  id: string;
  label: string;
  boreMm: number;
  shell: ShellSpec;
  /** Mount limits, degrees. */
  maxElevationDeg: number;
  minElevationDeg: number;
  /** Seconds to reload one turret after a salvo. */
  reloadSeconds: number;
  /** Turret training and gun elevating speeds, degrees per second. */
  trainRateDegPerSec: number;
  elevationRateDegPerSec: number;
  /** A howitzer: it is laid on the steep, plunging trajectory so that its shells drop over a ridge or through a deck. */
  highAngle?: boolean;
  /** Reduced charges as fractions of the full muzzle velocity, smallest first: a howitzer shortens its range by the charge, not the angle. */
  charges?: readonly number[];
}

export const GUN_12_45_MK_X: GunSpec = {
  id: '12-45-mk-x',
  label: '12"/45 Mk X',
  boreMm: 305,
  shell: { massKg: 386, diameterM: 0.305, muzzleVelocity: 823, formFactor: 1.5 },
  maxElevationDeg: 13.5,
  minElevationDeg: -3,
  reloadSeconds: 26,
  trainRateDegPerSec: 4.5,
  elevationRateDegPerSec: 4,
};

export const GUN_15_42_MK_I: GunSpec = {
  id: '15-42-mk-i',
  label: '15"/42 Mk I',
  boreMm: 381,
  shell: { massKg: 879, diameterM: 0.381, muzzleVelocity: 749, formFactor: 1.25 },
  maxElevationDeg: 20,
  minElevationDeg: -5,
  reloadSeconds: 22,
  trainRateDegPerSec: 5,
  elevationRateDegPerSec: 5,
};

/** The 12-pounder 18 cwt: the anti-destroyer gun of a Dreadnought. Quick-firing and light, with an impact-fuzed shell. */
export const GUN_12_PDR: GunSpec = {
  id: '12-pdr',
  label: '12-pdr 18 cwt',
  boreMm: 76,
  shell: { massKg: 5.7, diameterM: 0.0762, muzzleVelocity: 719, formFactor: 1.1, fillerKg: 0.45, fuze: 'impact' },
  maxElevationDeg: 20,
  minElevationDeg: -10,
  reloadSeconds: 4.5,
  trainRateDegPerSec: 22,
  elevationRateDegPerSec: 18,
};

/** The 8.8 cm gun of a German torpedo boat. */
export const GUN_88_SK: GunSpec = {
  id: '88-sk',
  label: '8.8 cm SK L/30',
  boreMm: 88,
  shell: { massKg: 7, diameterM: 0.088, muzzleVelocity: 600, formFactor: 1.3, fillerKg: 0.6, fuze: 'impact' },
  maxElevationDeg: 25,
  minElevationDeg: -10,
  reloadSeconds: 5,
  trainRateDegPerSec: 20,
  elevationRateDegPerSec: 15,
};

/**
 * The 28 cm SK L/40 of a German pre-dreadnought: a lighter shell than the British 12-inch and an older, blunter one, but
 * on mountings that elevate to 30 degrees and so reach about 19 km.
 */
export const GUN_28_40_SK: GunSpec = {
  id: '28-40-sk',
  label: '28 cm SK L/40',
  boreMm: 280,
  shell: { massKg: 240, diameterM: 0.28, muzzleVelocity: 820, formFactor: 1.7, fillerKg: 12 },
  maxElevationDeg: 30,
  minElevationDeg: -4,
  reloadSeconds: 25,
  trainRateDegPerSec: 3.2,
  elevationRateDegPerSec: 3.5,
};

/** The 17 cm SK L/40 of the casemate battery: quick-firing, light, and short-ranged. */
export const GUN_17_40_SK: GunSpec = {
  id: '17-40-sk',
  label: '17 cm SK L/40',
  boreMm: 172,
  shell: { massKg: 64, diameterM: 0.172, muzzleVelocity: 840, formFactor: 1.7, fillerKg: 3.2, fuze: 'impact' },
  maxElevationDeg: 20,
  minElevationDeg: -5,
  reloadSeconds: 9,
  trainRateDegPerSec: 6,
  elevationRateDegPerSec: 6,
};

/** The 15 cm SK L/40 of a coastal casemate: quick-firing, impact-fuzed, reaching about 15 km from a high site. */
export const GUN_15_40_COAST: GunSpec = {
  id: '15-40-coast',
  label: '15 cm SK L/40 (coast)',
  boreMm: 149,
  shell: { massKg: 45.3, diameterM: 0.149, muzzleVelocity: 835, formFactor: 1.6, fillerKg: 2.4, fuze: 'impact' },
  maxElevationDeg: 30,
  minElevationDeg: -5,
  reloadSeconds: 8,
  trainRateDegPerSec: 5,
  elevationRateDegPerSec: 5,
};

/** The 24 cm SK L/40 of a coastal battery: an armour-piercing shell that can hurt a dreadnought's side at a few kilometres. */
export const GUN_24_40_COAST: GunSpec = {
  id: '24-40-coast',
  label: '24 cm SK L/40 (coast)',
  boreMm: 240,
  shell: { massKg: 140, diameterM: 0.24, muzzleVelocity: 790, formFactor: 1.6, fillerKg: 6.5 },
  maxElevationDeg: 30,
  minElevationDeg: -5,
  reloadSeconds: 16,
  trainRateDegPerSec: 3,
  elevationRateDegPerSec: 3,
};

/** The 24 cm siege howitzer: a short, fat gun that lobs a heavy shell at 65 degrees, down onto decks from behind a ridge. */
export const GUN_24_HOWITZER: GunSpec = {
  id: '24-howitzer',
  label: '24 cm howitzer',
  boreMm: 240,
  shell: { massKg: 215, diameterM: 0.24, muzzleVelocity: 390, formFactor: 1.35, fillerKg: 14, fuze: 'delay' },
  maxElevationDeg: 65,
  minElevationDeg: 30,
  reloadSeconds: 28,
  trainRateDegPerSec: 4,
  elevationRateDegPerSec: 3,
  highAngle: true,
  charges: [0.3, 0.34, 0.38, 0.43, 0.48, 0.54, 0.61, 0.69, 0.77, 0.86, 0.95, 1],
};

/** The 30.5 cm L/45 of a heavy coastal battery: as hard a hitter as the Dreadnought's own twelve-inch, and behind a mountain of concrete. */
export const GUN_30_COAST: GunSpec = {
  id: '30-45-coast',
  label: '30.5 cm L/45 (coast)',
  boreMm: 305,
  shell: { massKg: 405, diameterM: 0.305, muzzleVelocity: 850, formFactor: 1.45, fillerKg: 16 },
  maxElevationDeg: 28,
  minElevationDeg: -4,
  reloadSeconds: 30,
  trainRateDegPerSec: 2.5,
  elevationRateDegPerSec: 2.5,
};

// ---- the capital ships' guns --------------------------------------------------------------------------------------------

/** The 6"/45 BL Mk XII of the Queen Elizabeth's casemates: hand-loaded, quick, short-ranged, and an impact-fuzed shell. */
export const GUN_6_45: GunSpec = {
  id: '6-45',
  label: '6"/45 BL Mk XII',
  boreMm: 152,
  shell: { massKg: 45.4, diameterM: 0.152, muzzleVelocity: 827, formFactor: 1.35, fillerKg: 2.5, fuze: 'impact' },
  maxElevationDeg: 15,
  minElevationDeg: -7,
  reloadSeconds: 7,
  trainRateDegPerSec: 8,
  elevationRateDegPerSec: 8,
};

/** The 6"/50 Mk XXIII in the twin turrets aft of a Nelson: a longer reach and a better mounting. */
export const GUN_6_50: GunSpec = {
  id: '6-50',
  label: '6"/50 Mk XXIII',
  boreMm: 152,
  shell: { massKg: 50.8, diameterM: 0.152, muzzleVelocity: 841, formFactor: 1.35, fillerKg: 2.8, fuze: 'impact' },
  maxElevationDeg: 45,
  minElevationDeg: -5,
  reloadSeconds: 6,
  trainRateDegPerSec: 10,
  elevationRateDegPerSec: 12,
};

/** The 5.25" dual-purpose gun of the King George V: a surface and an anti-aircraft weapon in one. */
export const GUN_5_25_DP: GunSpec = {
  id: '5.25-dp',
  label: '5.25" QF Mk I',
  boreMm: 133,
  shell: { massKg: 36.3, diameterM: 0.133, muzzleVelocity: 732, formFactor: 1.3, fillerKg: 2.1, fuze: 'impact' },
  maxElevationDeg: 45,
  minElevationDeg: -5,
  reloadSeconds: 5,
  trainRateDegPerSec: 12,
  elevationRateDegPerSec: 14,
};

/** The 16"/45 Mk I of the Nelson class: nine of them, all forward, the heaviest shell the Royal Navy ever fired from a ship. */
export const GUN_16_45_MK_I: GunSpec = {
  id: '16-45-mk-i',
  label: '16"/45 Mk I',
  boreMm: 406,
  shell: { massKg: 929, diameterM: 0.406, muzzleVelocity: 732, formFactor: 1.3 },
  maxElevationDeg: 30,
  minElevationDeg: -3,
  reloadSeconds: 26,
  trainRateDegPerSec: 4,
  elevationRateDegPerSec: 5,
};

/** The 14"/45 Mk VII of the King George V: a lighter shell than the 15-inch at a higher speed, in quadruple and twin mountings. */
export const GUN_14_45_MK_VII: GunSpec = {
  id: '14-45-mk-vii',
  label: '14"/45 Mk VII',
  boreMm: 356,
  shell: { massKg: 721, diameterM: 0.356, muzzleVelocity: 757, formFactor: 1.3 },
  maxElevationDeg: 30,
  minElevationDeg: -3,
  reloadSeconds: 28,
  trainRateDegPerSec: 4,
  elevationRateDegPerSec: 5,
};

/** The 30.5 cm SK L/50 of the Kaiser class: ten in five twin turrets, a flat, fast shell and a fine German sight. */
export const GUN_30_50_SK: GunSpec = {
  id: '30.5-50-sk',
  label: '30.5 cm SK L/50',
  boreMm: 305,
  shell: { massKg: 405, diameterM: 0.305, muzzleVelocity: 875, formFactor: 1.5, fillerKg: 18 },
  maxElevationDeg: 16,
  minElevationDeg: -5,
  reloadSeconds: 24,
  trainRateDegPerSec: 3.5,
  elevationRateDegPerSec: 4,
};

/** The 15 cm SK L/45 of the dreadnoughts' casemates. */
export const GUN_15_45_SK: GunSpec = {
  id: '15-45-sk',
  label: '15 cm SK L/45',
  boreMm: 149,
  shell: { massKg: 45.3, diameterM: 0.149, muzzleVelocity: 835, formFactor: 1.5, fillerKg: 2.4, fuze: 'impact' },
  maxElevationDeg: 20,
  minElevationDeg: -7,
  reloadSeconds: 7,
  trainRateDegPerSec: 6,
  elevationRateDegPerSec: 8,
};

/** The 38 cm SK C/34 of the Bismarck: eight in four twin turrets, as accurate as any heavy gun afloat. */
export const GUN_38_SK_C34: GunSpec = {
  id: '38-52-sk-c34',
  label: '38 cm SK C/34',
  boreMm: 380,
  shell: { massKg: 800, diameterM: 0.38, muzzleVelocity: 820, formFactor: 1.3, fillerKg: 28 },
  maxElevationDeg: 30,
  minElevationDeg: -5,
  reloadSeconds: 25,
  trainRateDegPerSec: 3,
  elevationRateDegPerSec: 6,
};

/** The 15 cm SK C/28 of the Bismarck's secondary battery. */
export const GUN_15_55_SK_C28: GunSpec = {
  id: '15-55-sk-c28',
  label: '15 cm SK C/28',
  boreMm: 149,
  shell: { massKg: 45.3, diameterM: 0.149, muzzleVelocity: 875, formFactor: 1.4, fillerKg: 2.6, fuze: 'impact' },
  maxElevationDeg: 40,
  minElevationDeg: -10,
  reloadSeconds: 6,
  trainRateDegPerSec: 8,
  elevationRateDegPerSec: 10,
};
