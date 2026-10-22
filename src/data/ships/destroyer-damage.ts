import type { DamageSpec } from '../../sim/damage/spec';

/** A torpedo boat is plated with a few millimetres of mild steel: any shell goes through it and any hit hurts. */
export const DESTROYER_DAMAGE: DamageSpec = {
  displacementT: 560,
  gm: 0.8,
  reserveT: 200,
  pumpTonnesPerSecond: 0.6,
  parties: 2,
  flashProtection: 0,
  fragility: 7,
  armor: {
    belt: { x0: -30, x1: 30, mm: 6, endsMm: 6 },
    upperSide: { x0: -30, x1: 30, mm: 5 },
    deck: { x0: -30, x1: 30, mm: 5 },
    plating: 5,
    turretFace: 6,
    turretSide: 5,
    turretRoof: 4,
    barbette: 5,
    conning: 6,
    light: { face: 6, side: 5, roof: 4, barbette: 5 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 20, x1: 33.6, capacityT: 70, crew: 12 },
    { id: 'mag', name: 'Magazine', role: 'magazine', x0: 11, x1: 20, capacityT: 45, crew: 8, feeds: ['G1', 'G2'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 0, x1: 11, capacityT: 80, crew: 20, power: 0.45 },
    { id: 'boiler-2', name: 'After boiler room', role: 'boiler', x0: -12, x1: 0, capacityT: 85, crew: 20, power: 0.45 },
    { id: 'engine', name: 'Engine room', role: 'engine', x0: -26, x1: -12, capacityT: 95, crew: 18, power: 0.1 },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -33.6, x1: -26, capacityT: 40, crew: 8 },
  ],
};
