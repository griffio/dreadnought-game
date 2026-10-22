import type { DamageSpec } from '../../sim/damage/spec';
import { sideIds } from './kit';

const CASEMATES = sideIds(6);

/**
 * HMS Queen Elizabeth's protection: a 13-inch belt, 6-inch upper side and casemate armour, a deck of about 3 inches over the
 * vitals, and 13-inch turrets. The post-Jutland flash doors are fitted, so the magazines are safer than the Dreadnought's; the
 * deck is still thin against plunging fire at long range.
 */
export const QUEEN_ELIZABETH_DAMAGE: DamageSpec = {
  displacementT: 33_000,
  gm: 2.6,
  reserveT: 13_500,
  pumpTonnesPerSecond: 3.0,
  parties: 5,
  flashProtection: 0.35,
  torpedoProtection: 0.12,
  armor: {
    belt: { x0: -62, x1: 62, mm: 330, endsMm: 152 },
    upperSide: { x0: -50, x1: 55, mm: 152 },
    deck: { x0: -72, x1: 78, mm: 76 },
    plating: 25,
    turretFace: 330,
    turretSide: 229,
    turretRoof: 114,
    barbette: 254,
    conning: 280,
    light: { face: 152, side: 50, roof: 25, barbette: 100 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 80, x1: 98.4, capacityT: 1700, crew: 25 },
    { id: 'mag-A', name: 'A magazine', role: 'magazine', x0: 63, x1: 80, capacityT: 1700, crew: 55, feeds: ['A'] },
    { id: 'mag-B', name: 'B magazine', role: 'magazine', x0: 44, x1: 63, capacityT: 2000, crew: 55, feeds: ['B'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 26, x1: 44, capacityT: 2600, crew: 130, power: 0.22 },
    { id: 'mag-S1', name: 'Forward casemate magazine', role: 'magazine', x0: 18, x1: 26, capacityT: 800, crew: 40, feeds: [...CASEMATES.starboard.slice(0, 3), ...CASEMATES.port.slice(0, 3)] },
    { id: 'boiler-2', name: 'Centre boiler room', role: 'boiler', x0: 0, x1: 18, capacityT: 2500, crew: 130, power: 0.22 },
    { id: 'boiler-3', name: 'After boiler room', role: 'boiler', x0: -16, x1: 0, capacityT: 2400, crew: 130, power: 0.22 },
    { id: 'mag-S2', name: 'After casemate magazine', role: 'magazine', x0: -24, x1: -16, capacityT: 700, crew: 40, feeds: [...CASEMATES.starboard.slice(3), ...CASEMATES.port.slice(3)] },
    { id: 'engine', name: 'Engine rooms', role: 'engine', x0: -46, x1: -24, capacityT: 3000, crew: 150, power: 0.34 },
    { id: 'mag-X', name: 'X magazine', role: 'magazine', x0: -60, x1: -46, capacityT: 1600, crew: 50, feeds: ['X'] },
    { id: 'mag-Y', name: 'Y magazine', role: 'magazine', x0: -77, x1: -60, capacityT: 1600, crew: 50, feeds: ['Y'] },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -86, x1: -77, capacityT: 600, crew: 25 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -98.4, x1: -86, capacityT: 600, crew: 10 },
  ],
};
