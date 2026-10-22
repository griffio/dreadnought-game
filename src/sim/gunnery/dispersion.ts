import type { Rng } from '../rng';

/**
 * Why shells from one aim do not land on one spot. Part of the scatter is shared by every gun in a salvo (the ship's
 * motion at the moment of firing, the gunnery table's rounding, a mount alignment): the whole pattern wanders as
 * a group. The rest is per shell: propellant charge, barrel wear, tiny elevation and training differences.
 */
export interface DispersionSpec {
  /** Per shell: fractional muzzle-velocity scatter and angular scatter (radians), one sigma. */
  velocity: number;
  elevation: number;
  azimuth: number;
  /** Shared by the whole salvo, same units. */
  salvoVelocity: number;
  salvoElevation: number;
  salvoAzimuth: number;
}

const DEG = Math.PI / 180;

/** About 0.45% of range along the line of fire and 0.05% across it for an individual shell, at 12 km. */
export const DEFAULT_DISPERSION: DispersionSpec = {
  velocity: 0.0025,
  elevation: 0.015 * DEG,
  azimuth: 0.025 * DEG,
  salvoVelocity: 0.0015,
  salvoElevation: 0.01 * DEG,
  salvoAzimuth: 0.02 * DEG,
};

export interface SalvoBias {
  velocity: number;
  elevation: number;
  azimuth: number;
}

export function newSalvoBias(rng: Rng, d: DispersionSpec): SalvoBias {
  return {
    velocity: rng.gaussian() * d.salvoVelocity,
    elevation: rng.gaussian() * d.salvoElevation,
    azimuth: rng.gaussian() * d.salvoAzimuth,
  };
}

export interface ShotJitter {
  /** Multiplies the muzzle velocity. */
  velocityScale: number;
  /** Added to the gun's elevation and azimuth, radians. */
  dElevation: number;
  dAzimuth: number;
}

export function shotJitter(rng: Rng, d: DispersionSpec, bias: SalvoBias): ShotJitter {
  return {
    velocityScale: 1 + bias.velocity + rng.gaussian() * d.velocity,
    dElevation: bias.elevation + rng.gaussian() * d.elevation,
    dAzimuth: bias.azimuth + rng.gaussian() * d.azimuth,
  };
}
