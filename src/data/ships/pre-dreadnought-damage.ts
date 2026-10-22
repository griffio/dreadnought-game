import type { DamageSpec } from '../../sim/damage/spec';

/**
 * The pre-dreadnought's protection: a 225 mm belt, casemate armour above it, a thin deck, and heavy turrets. She is less
 * stiff and has less reserve of buoyancy than the Dreadnought, and no flash protection of any kind.
 */
export const PRE_DREADNOUGHT_DAMAGE: DamageSpec = {
  displacementT: 13_200,
  gm: 1.9,
  reserveT: 5_600,
  pumpTonnesPerSecond: 1.6,
  parties: 3,
  flashProtection: 0,
  armor: {
    belt: { x0: -38, x1: 38, mm: 225, endsMm: 100 },
    upperSide: { x0: -36, x1: 36, mm: 150 },
    deck: { x0: -42, x1: 42, mm: 40 },
    plating: 20,
    turretFace: 250,
    turretSide: 200,
    turretRoof: 50,
    barbette: 250,
    conning: 300,
    light: { face: 150, side: 100, roof: 25, barbette: 100 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 48, x1: 63.9, capacityT: 800, crew: 20 },
    { id: 'mag-F', name: 'Forward magazine', role: 'magazine', x0: 34, x1: 48, capacityT: 950, crew: 40, feeds: ['F'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 14, x1: 34, capacityT: 1500, crew: 110, power: 0.38 },
    { id: 'mag-S1', name: 'Forward casemate magazine', role: 'magazine', x0: 7, x1: 14, capacityT: 480, crew: 35, feeds: ['S1', 'S2', 'S3', 'P1', 'P2', 'P3'] },
    { id: 'mag-S2', name: 'After casemate magazine', role: 'magazine', x0: 0, x1: 7, capacityT: 470, crew: 35, feeds: ['S4', 'S5', 'S6', 'P4', 'P5', 'P6'] },
    { id: 'boiler-2', name: 'After boiler room', role: 'boiler', x0: -14, x1: 0, capacityT: 1150, crew: 100, power: 0.38 },
    { id: 'engine', name: 'Engine room', role: 'engine', x0: -34, x1: -14, capacityT: 1700, crew: 100, power: 0.24 },
    { id: 'mag-R', name: 'After magazine', role: 'magazine', x0: -48, x1: -34, capacityT: 850, crew: 40, feeds: ['R'] },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -58, x1: -48, capacityT: 500, crew: 20 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -63.9, x1: -58, capacityT: 350, crew: 10 },
  ],
};
