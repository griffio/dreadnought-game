import type { DamageSpec } from '../../sim/damage/spec';
import { sideIds } from './kit';

const DUAL_PURPOSE = sideIds(4);

/**
 * HMS King George V's protection: a 14-inch belt over the machinery and magazines, a 5-to-6-inch deck, and 12.75-inch turret
 * faces. Designed against 14-inch fire at the ranges of the thirties, she is sound against anything but the heaviest shells at
 * close range, and very hard to put down by flooding.
 */
export const KING_GEORGE_V_DAMAGE: DamageSpec = {
  displacementT: 40_000,
  gm: 2.8,
  reserveT: 16_000,
  pumpTonnesPerSecond: 3.6,
  parties: 6,
  flashProtection: 0.45,
  torpedoProtection: 0.35,
  armor: {
    belt: { x0: -62, x1: 74, mm: 356, endsMm: 40 },
    upperSide: { x0: -60, x1: 70, mm: 152 },
    deck: { x0: -70, x1: 86, mm: 140 },
    plating: 25,
    turretFace: 324,
    turretSide: 254,
    turretRoof: 150,
    barbette: 324,
    conning: 150,
    light: { face: 25, side: 25, roof: 25, barbette: 38 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 92, x1: 113.55, capacityT: 2000, crew: 25 },
    { id: 'mag-A', name: 'A magazine', role: 'magazine', x0: 70, x1: 92, capacityT: 2200, crew: 70, feeds: ['A'] },
    { id: 'mag-B', name: 'B magazine', role: 'magazine', x0: 52, x1: 70, capacityT: 1800, crew: 55, feeds: ['B'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 34, x1: 52, capacityT: 2800, crew: 130, power: 0.17 },
    { id: 'mag-D1', name: 'Forward 5.25-inch magazine', role: 'magazine', x0: 26, x1: 34, capacityT: 800, crew: 40, feeds: [...DUAL_PURPOSE.starboard.slice(0, 2), ...DUAL_PURPOSE.port.slice(0, 2)] },
    { id: 'boiler-2', name: 'Second boiler room', role: 'boiler', x0: 8, x1: 26, capacityT: 2800, crew: 130, power: 0.17 },
    { id: 'engine-1', name: 'Forward engine room', role: 'engine', x0: -10, x1: 8, capacityT: 2800, crew: 110, power: 0.18 },
    { id: 'boiler-3', name: 'After boiler room', role: 'boiler', x0: -28, x1: -10, capacityT: 2700, crew: 130, power: 0.16 },
    { id: 'mag-D2', name: 'After 5.25-inch magazine', role: 'magazine', x0: -36, x1: -28, capacityT: 800, crew: 40, feeds: [...DUAL_PURPOSE.starboard.slice(2), ...DUAL_PURPOSE.port.slice(2)] },
    { id: 'engine-2', name: 'After engine rooms', role: 'engine', x0: -56, x1: -36, capacityT: 3200, crew: 140, power: 0.32 },
    { id: 'mag-Y', name: 'Y magazine', role: 'magazine', x0: -76, x1: -56, capacityT: 2400, crew: 70, feeds: ['Y'] },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -88, x1: -76, capacityT: 700, crew: 25 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -113.55, x1: -88, capacityT: 1200, crew: 10 },
  ],
};
