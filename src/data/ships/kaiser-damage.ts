import type { DamageSpec } from '../../sim/damage/spec';
import { sideIds } from './kit';

const CASEMATES = sideIds(6);

/**
 * SMS Kaiser's protection: a 350 mm Krupp belt, a 200 mm upper strake, 170 mm casemates, a deck of 60 to 80 mm and 300 mm
 * turret faces. The German ships were closely subdivided and took a great deal of punishing, and the flash doors and
 * double-door hoists that the Seydlitz's near-loss at Dogger Bank taught them to fit; but their cordite was still stowed in brass cases.
 */
export const KAISER_DAMAGE: DamageSpec = {
  displacementT: 24_700,
  gm: 2.3,
  reserveT: 10_500,
  pumpTonnesPerSecond: 2.6,
  parties: 4,
  flashProtection: 0.3,
  torpedoProtection: 0.2,
  armor: {
    belt: { x0: -50, x1: 52, mm: 350, endsMm: 150 },
    upperSide: { x0: -48, x1: 50, mm: 200 },
    deck: { x0: -62, x1: 64, mm: 70 },
    plating: 22,
    turretFace: 300,
    turretSide: 250,
    turretRoof: 100,
    barbette: 300,
    conning: 400,
    light: { face: 170, side: 100, roof: 25, barbette: 100 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 70, x1: 86.2, capacityT: 1100, crew: 20 },
    { id: 'mag-A', name: 'A magazine', role: 'magazine', x0: 52, x1: 70, capacityT: 1500, crew: 45, feeds: ['A'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 34, x1: 52, capacityT: 2100, crew: 115, power: 0.22 },
    { id: 'boiler-2', name: 'Centre boiler room', role: 'boiler', x0: 22, x1: 34, capacityT: 1300, crew: 90, power: 0.22 },
    { id: 'mag-P', name: 'Port wing and forward casemate magazine', role: 'magazine', x0: 10, x1: 22, capacityT: 900, crew: 40, feeds: ['P', ...CASEMATES.starboard.slice(0, 3), ...CASEMATES.port.slice(0, 3)] },
    { id: 'mag-Q', name: 'Starboard wing and after casemate magazine', role: 'magazine', x0: -8, x1: 10, capacityT: 1000, crew: 40, feeds: ['Q', ...CASEMATES.starboard.slice(3), ...CASEMATES.port.slice(3)] },
    { id: 'boiler-3', name: 'After boiler room', role: 'boiler', x0: -20, x1: -8, capacityT: 1400, crew: 90, power: 0.22 },
    { id: 'engine', name: 'Engine rooms', role: 'engine', x0: -38, x1: -20, capacityT: 2100, crew: 110, power: 0.34 },
    { id: 'mag-X', name: 'X magazine', role: 'magazine', x0: -52, x1: -38, capacityT: 1000, crew: 40, feeds: ['X'] },
    { id: 'mag-Y', name: 'Y magazine', role: 'magazine', x0: -70, x1: -52, capacityT: 1300, crew: 40, feeds: ['Y'] },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -80, x1: -70, capacityT: 500, crew: 20 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -86.2, x1: -80, capacityT: 350, crew: 10 },
  ],
};
