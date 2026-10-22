import type { ShipSpec } from '../../render/ships/forge/spec';
import type { ShipPaint } from '../../render/ships/ship-renderer';
import { AGGRESSIVE, BISMARCK_CAPTAIN, CRIPPLED_CAPTAIN, HIGH_SEAS_FLEET, type AiProfile } from '../../sim/combat/ai';
import type { ShipSetup } from '../../sim/combat/setup';
import { BISMARCK } from './bismarck';
import { DESTROYER } from './destroyer';
import { DREADNOUGHT } from './dreadnought';
import {
  BISMARCK_SETUP,
  BISMARCK_WOUNDED_SETUP,
  DESTROYER_SETUP,
  DREADNOUGHT_SETUP,
  KAISER_SETUP,
  KING_GEORGE_V_SETUP,
  PRE_DREADNOUGHT_SETUP,
  QUEEN_ELIZABETH_SETUP,
  RODNEY_SETUP,
} from './fleet';
import { KAISER } from './kaiser';
import { KING_GEORGE_V } from './king-george-v';
import { NELSON } from './nelson';
import { PRE_DREADNOUGHT } from './pre-dreadnought';
import { QUEEN_ELIZABETH } from './queen-elizabeth';

export type ShipId = 'dreadnought' | 'queen-elizabeth' | 'rodney' | 'king-george-v' | 'hessen' | 'kaiser' | 'bismarck' | 'bismarck-wounded' | 'destroyer';

type Paint = Pick<ShipPaint, 'hull' | 'superstructure'>;

/** A ship the game can put on the water: her setup, her model, and what the menu says about her. */
export interface ShipEntry {
  id: ShipId;
  setup: ShipSetup;
  spec: ShipSpec;
  /** Class and year, for the briefing: 'Queen Elizabeth class · 1915'. */
  caption: string;
  /** What she is like to command, a line for the menu. */
  character: string;
  paint?: Paint;
  /** How her captain fights her when she is the enemy. */
  profile?: AiProfile;
}

const HOME_FLEET: Paint = { hull: [0.125, 0.14, 0.158], superstructure: [0.19, 0.205, 0.222] };
const GERMAN_GREY: Paint = { hull: [0.17, 0.18, 0.192], superstructure: [0.23, 0.24, 0.252] };

/** How weathered each ship is, 0 as new to 1 long at sea: the 1907 Dreadnought is worn, the 1941 ships are fresh from the dockyard. */
const WEATHERING: Record<ShipId, number> = {
  dreadnought: 0.7,
  'queen-elizabeth': 0.55,
  rodney: 0.45,
  'king-george-v': 0.32,
  hessen: 0.75,
  kaiser: 0.5,
  bismarck: 0.3,
  'bismarck-wounded': 0.5,
  destroyer: 0.6,
};

/** The paint a ship is drawn with: her colours, if she has her own, and how weathered she is. */
export function paintOf(entry: ShipEntry): Partial<ShipPaint> {
  return { ...entry.paint, weathering: WEATHERING[entry.id] };
}

export const ROSTER: Record<ShipId, ShipEntry> = {
  dreadnought: {
    id: 'dreadnought',
    setup: DREADNOUGHT_SETUP,
    spec: DREADNOUGHT,
    caption: 'HMS Dreadnought · 1907',
    character: 'Ten 12-inch guns, 21 knots, and twelve-pounders for the torpedo boats.',
  },
  'queen-elizabeth': {
    id: 'queen-elizabeth',
    setup: QUEEN_ELIZABETH_SETUP,
    spec: QUEEN_ELIZABETH,
    caption: 'HMS Queen Elizabeth · 1915',
    character: 'Eight 15-inch guns and 24 knots: the fast battleship. Six-inch casemates, thin deck.',
  },
  rodney: {
    id: 'rodney',
    setup: RODNEY_SETUP,
    spec: NELSON,
    caption: 'HMS Rodney · 1941',
    character: 'Nine 16-inch guns, all forward and blind astern. Slow, enormously armoured.',
    paint: HOME_FLEET,
  },
  'king-george-v': {
    id: 'king-george-v',
    setup: KING_GEORGE_V_SETUP,
    spec: KING_GEORGE_V,
    caption: 'HMS King George V · 1941',
    character: 'Ten 14-inch guns and radar ranging, 28 knots. The quadruple turrets jam.',
    paint: HOME_FLEET,
  },
  hessen: {
    id: 'hessen',
    setup: PRE_DREADNOUGHT_SETUP,
    spec: PRE_DREADNOUGHT,
    caption: 'SMS Hessen · 1905',
    character: 'A German pre-dreadnought with a heavy casemate battery.',
    profile: AGGRESSIVE,
  },
  kaiser: {
    id: 'kaiser',
    setup: KAISER_SETUP,
    spec: KAISER,
    caption: 'SMS Kaiser · 1912',
    character: 'Ten 30.5 cm guns on a flat trajectory, well armoured and closely subdivided.',
    paint: GERMAN_GREY,
    profile: HIGH_SEAS_FLEET,
  },
  bismarck: {
    id: 'bismarck',
    setup: BISMARCK_SETUP,
    spec: BISMARCK,
    caption: 'Bismarck · 1941',
    character: 'Eight 38 cm guns, the best fire control afloat, and 30 knots.',
    paint: GERMAN_GREY,
    profile: BISMARCK_CAPTAIN,
  },
  'bismarck-wounded': {
    id: 'bismarck-wounded',
    setup: BISMARCK_WOUNDED_SETUP,
    spec: BISMARCK,
    caption: 'Bismarck · 27 May 1941',
    character: 'Her rudder jammed, two turrets gone, and no thought of surrender.',
    paint: { hull: [0.11, 0.115, 0.122], superstructure: [0.15, 0.155, 0.165] },
    profile: CRIPPLED_CAPTAIN,
  },
  destroyer: {
    id: 'destroyer',
    setup: DESTROYER_SETUP,
    spec: DESTROYER,
    caption: 'SMS S 144',
    character: 'A German torpedo boat.',
    paint: { hull: [0.14, 0.15, 0.165], superstructure: [0.2, 0.21, 0.225] },
  },
};

export function shipById(id: string | null | undefined, fallback: ShipId = 'dreadnought'): ShipEntry {
  return ROSTER[(id as ShipId) in ROSTER ? (id as ShipId) : fallback];
}

export function isShipId(id: string | null | undefined): id is ShipId {
  return id !== null && id !== undefined && id in ROSTER;
}
