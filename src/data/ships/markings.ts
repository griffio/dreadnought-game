import type { ShipMarkings } from '../../render/ships/marks';
import type { ShipId } from './roster';

/**
 * What each ship wears and flies. The Royal Navy lettered its turrets and, in the Second World War, painted pennant numbers on the bow
 * (Rodney 29, King George V 41, Queen Elizabeth 00); the capital ships of 1907 and 1915 carried none. The German ships fly the ensign of
 * their day. (The Kriegsmarine's carries an emblem that is not drawn here: see the 'reich' flag in ship.wgsl.)
 */
export const MARKINGS: Record<ShipId, ShipMarkings> = {
  dreadnought: { turretLetters: true, ensign: 'white' },
  'queen-elizabeth': { hullNumber: '00', turretLetters: true, ensign: 'white' },
  rodney: { hullNumber: '29', turretLetters: true, ensign: 'white' },
  'king-george-v': { hullNumber: '41', turretLetters: true, ensign: 'white' },
  hessen: { ensign: 'imperial' },
  kaiser: { ensign: 'imperial' },
  bismarck: { ensign: 'reich' },
  'bismarck-wounded': { ensign: 'reich' },
  destroyer: { hullNumber: 'S144', ensign: 'imperial' },
};

/** The seed of each ship's dazzle pattern (every ship has her own). */
export const DAZZLE_SEED: Record<ShipId, number> = {
  dreadnought: 3,
  'queen-elizabeth': 7,
  rodney: 11,
  'king-george-v': 5,
  hessen: 13,
  kaiser: 17,
  bismarck: 19,
  'bismarck-wounded': 19,
  destroyer: 23,
};
