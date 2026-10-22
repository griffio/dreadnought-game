import type { DamageSpec } from '../../sim/damage/spec';

/**
 * HMS Dreadnought's armour and watertight divisions. Thicknesses are the published ones rounded (11-inch belt and barbettes,
 * 8-inch upper strake, 3-inch turret roofs, a thin deck); the compartment plan is laid out to put the magazines, boilers and
 * engines where a hit on the visible ship would plausibly reach them.
 */
export const DREADNOUGHT_DAMAGE: DamageSpec = {
  displacementT: 18_100,
  gm: 2.6,
  reserveT: 7_500,
  pumpTonnesPerSecond: 2.0,
  parties: 4,
  flashProtection: 0,
  armor: {
    belt: { x0: -50, x1: 50, mm: 279, endsMm: 102 },
    upperSide: { x0: -45, x1: 45, mm: 203 },
    deck: { x0: -55, x1: 55, mm: 50 },
    plating: 25,
    turretFace: 279,
    turretSide: 203,
    turretRoof: 76,
    barbette: 279,
    conning: 279,
    light: { face: 12, side: 6, roof: 4, barbette: 6 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 60, x1: 80.4, capacityT: 1100, crew: 20 },
    { id: 'mag-A', name: 'A magazine', role: 'magazine', x0: 42, x1: 60, capacityT: 1400, crew: 45, feeds: ['A'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 22, x1: 42, capacityT: 2300, crew: 120, power: 0.38 },
    { id: 'mag-PQ', name: 'Wing magazines', role: 'magazine', x0: 0, x1: 22, capacityT: 2100, crew: 80, feeds: ['P', 'Q'] },
    { id: 'boiler-2', name: 'After boiler room', role: 'boiler', x0: -22, x1: 0, capacityT: 2500, crew: 120, power: 0.38 },
    { id: 'engine', name: 'Engine room', role: 'engine', x0: -44, x1: -22, capacityT: 2300, crew: 110, power: 0.24 },
    { id: 'mag-X', name: 'X magazine', role: 'magazine', x0: -56, x1: -44, capacityT: 950, crew: 40, feeds: ['X'] },
    { id: 'mag-Y', name: 'Y magazine', role: 'magazine', x0: -70, x1: -56, capacityT: 1000, crew: 40, feeds: ['Y'] },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -76, x1: -70, capacityT: 450, crew: 20 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -80.4, x1: -76, capacityT: 450, crew: 10 },
  ],
};
