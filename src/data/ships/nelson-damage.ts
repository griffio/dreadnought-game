import type { DamageSpec } from '../../sim/damage/spec';
import { sideIds } from './kit';

const SECONDARY = sideIds(3);

/**
 * The Nelsons' "all or nothing" protection: a short citadel with a 14-inch inclined belt from the forward barbette to just abaft
 * the machinery and a thick deck over it, and nothing worth the name at the ends. Behind the belt she is as hard a target as any
 * ship afloat; the unarmoured bow and stern can be flooded freely and are the way to hurt her.
 */
export const NELSON_DAMAGE: DamageSpec = {
  displacementT: 34_000,
  gm: 2.5,
  reserveT: 12_500,
  pumpTonnesPerSecond: 3.2,
  parties: 5,
  flashProtection: 0.4,
  torpedoProtection: 0.3,
  armor: {
    belt: { x0: -34, x1: 92, mm: 356, endsMm: 25 },
    // The belt is carried up to the main deck: there is no weak strake above it.
    upperSide: { x0: -34, x1: 92, mm: 300 },
    deck: { x0: -34, x1: 92, mm: 150 },
    plating: 25,
    turretFace: 406,
    turretSide: 280,
    turretRoof: 190,
    barbette: 380,
    conning: 356,
    light: { face: 25, side: 25, roof: 25, barbette: 50 },
  },
  compartments: [
    { id: 'bow', name: 'Bow', role: 'void', x0: 94, x1: 108.3, capacityT: 1800, crew: 25 },
    { id: 'mag-A', name: 'A magazine', role: 'magazine', x0: 76, x1: 94, capacityT: 2200, crew: 60, feeds: ['A'] },
    { id: 'mag-B', name: 'B magazine', role: 'magazine', x0: 58, x1: 76, capacityT: 2200, crew: 60, feeds: ['B'] },
    { id: 'mag-C', name: 'C magazine', role: 'magazine', x0: 38, x1: 58, capacityT: 2300, crew: 60, feeds: ['C'] },
    { id: 'boiler-1', name: 'Forward boiler room', role: 'boiler', x0: 22, x1: 38, capacityT: 2600, crew: 130, power: 0.25 },
    { id: 'boiler-2', name: 'After boiler room', role: 'boiler', x0: 4, x1: 22, capacityT: 2800, crew: 130, power: 0.25 },
    { id: 'engine-1', name: 'Forward engine room', role: 'engine', x0: -14, x1: 4, capacityT: 2800, crew: 110, power: 0.25 },
    { id: 'engine-2', name: 'After engine room', role: 'engine', x0: -30, x1: -14, capacityT: 2600, crew: 110, power: 0.25 },
    { id: 'mag-S', name: '6-inch magazines', role: 'magazine', x0: -56, x1: -30, capacityT: 2400, crew: 70, feeds: [...SECONDARY.all] },
    { id: 'hold', name: 'After hold', role: 'void', x0: -84, x1: -56, capacityT: 2600, crew: 20 },
    { id: 'steering', name: 'Steering gear', role: 'steering', x0: -98, x1: -84, capacityT: 700, crew: 25 },
    { id: 'stern', name: 'Stern', role: 'void', x0: -108.3, x1: -98, capacityT: 500, crew: 10 },
  ],
};
