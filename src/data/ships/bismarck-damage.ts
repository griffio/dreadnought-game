import type { DamageSpec } from '../../sim/damage/spec';
import { sideIds } from './kit';

const SECONDARY = sideIds(3);

/**
 * Bismarck's protection: a 320 mm Krupp belt, a 145 mm upper belt, a deck of 120 mm over the citadel, 360 mm turret faces and
 * the most elaborate underwater protection of any battleship of her time. Ten British torpedoes struck her, and the one that
 * mattered hit the steering gear. Her magazines are protected, and her damage control was excellent.
 */
export const BISMARCK_DAMAGE: DamageSpec = {
  displacementT: 50_900,
  gm: 3.1,
  reserveT: 21_000,
  pumpTonnesPerSecond: 4.5,
  parties: 7,
  flashProtection: 0.55,
  torpedoProtection: 0.5,
  armor: {
    belt: { x0: -62, x1: 80, mm: 320, endsMm: 80 },
    upperSide: { x0: -60, x1: 78, mm: 145 },
    deck: { x0: -74, x1: 96, mm: 120 },
    plating: 30,
    turretFace: 360,
    turretSide: 220,
    turretRoof: 130,
    barbette: 340,
    conning: 350,
    light: { face: 100, side: 40, roof: 20, barbette: 80 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 104, x1: 125.5, capacityT: 2400, crew: 30 },
    { id: 'mag-A', name: 'Anton magazine', role: 'magazine', x0: 86, x1: 104, capacityT: 2300, crew: 70, feeds: ['A'] },
    { id: 'mag-B', name: 'Bruno magazine', role: 'magazine', x0: 66, x1: 86, capacityT: 2300, crew: 70, feeds: ['B'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 46, x1: 66, capacityT: 3200, crew: 140, power: 0.17 },
    { id: 'mag-S1', name: 'Forward 15 cm magazine', role: 'magazine', x0: 32, x1: 46, capacityT: 1100, crew: 45, feeds: [SECONDARY.starboard[0]!, SECONDARY.port[0]!] },
    { id: 'boiler-2', name: 'Centre boiler room', role: 'boiler', x0: 14, x1: 32, capacityT: 3000, crew: 140, power: 0.17 },
    { id: 'mag-S2', name: 'Middle 15 cm magazine', role: 'magazine', x0: 4, x1: 14, capacityT: 900, crew: 45, feeds: [SECONDARY.starboard[1]!, SECONDARY.port[1]!] },
    { id: 'boiler-3', name: 'After boiler room', role: 'boiler', x0: -12, x1: 4, capacityT: 2800, crew: 140, power: 0.17 },
    { id: 'engine-1', name: 'Turbine room', role: 'engine', x0: -26, x1: -12, capacityT: 2600, crew: 110, power: 0.25 },
    { id: 'mag-S3', name: 'After 15 cm magazine', role: 'magazine', x0: -38, x1: -26, capacityT: 1000, crew: 45, feeds: [SECONDARY.starboard[2]!, SECONDARY.port[2]!] },
    { id: 'engine-2', name: 'After turbine room', role: 'engine', x0: -52, x1: -38, capacityT: 2800, crew: 110, power: 0.24 },
    { id: 'mag-X', name: 'Caesar magazine', role: 'magazine', x0: -70, x1: -52, capacityT: 2200, crew: 70, feeds: ['X'] },
    { id: 'mag-Y', name: 'Dora magazine', role: 'magazine', x0: -90, x1: -70, capacityT: 2300, crew: 70, feeds: ['Y'] },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -104, x1: -90, capacityT: 900, crew: 30 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -125.5, x1: -104, capacityT: 1500, crew: 15 },
  ],
};
