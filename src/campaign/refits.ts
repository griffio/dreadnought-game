import type { ShipSetup } from '../sim/combat/setup';
import { RANGEFINDER_15FT, RANGEFINDER_30FT } from '../sim/gunnery/rangefinder';

export type RefitId = 'rangefinder' | 'flash' | 'bulges' | 'damage-control' | 'dazzle';

export interface RefitLevelDef {
  /** Prestige it costs to fit. */
  cost: number;
  label: string;
  /** What it does for the ship, in a line. */
  effect: string;
}

export interface RefitDef {
  id: RefitId;
  name: string;
  blurb: string;
  /** Level 1 is the first fit, level 2 the second. Level 0 is as built. */
  levels: readonly RefitLevelDef[];
  /** The sortie that must be open before the dockyard will do it (the practice of the day: dazzle came in 1917), and what to tell the player. */
  after?: { mission: string; text: string };
}

export type RefitLevels = Record<RefitId, number>;

/** What the Admiralty will pay to have done in the dockyard between sorties. */
export const REFITS: readonly RefitDef[] = [
  {
    id: 'rangefinder',
    name: 'Rangefinders',
    blurb: 'A longer optical base reads the range more exactly, and the first salvo falls nearer the target.',
    levels: [
      { cost: 14, label: '15-foot rangefinders', effect: 'Range error falls by about a third.' },
      { cost: 30, label: '30-foot rangefinders', effect: 'Range error halved, and a smaller systematic miss.' },
    ],
  },
  {
    id: 'flash',
    name: 'Anti-flash gear',
    blurb: 'Flash-tight scuttles and doors between the turrets and the magazines, as the battle-cruisers lacked at Jutland.',
    levels: [
      { cost: 12, label: 'Flash doors', effect: 'Half the risk of a magazine going up.' },
      { cost: 26, label: 'Full anti-flash fit', effect: 'Most of that risk gone.' },
    ],
  },
  {
    id: 'bulges',
    name: 'Torpedo bulges',
    blurb: 'Blisters along the hull to take a torpedo before it reaches the vitals.',
    levels: [
      { cost: 16, label: 'Light bulges', effect: 'A torpedo hit does about a fifth less harm.' },
      { cost: 32, label: 'Deep bulges', effect: 'A torpedo hit does about a third less harm.' },
    ],
  },
  {
    id: 'damage-control',
    name: 'Damage control',
    blurb: 'More trained parties, better pumps, and counter-flooding drills.',
    levels: [
      { cost: 10, label: 'Extra party and pumps', effect: 'One more party; pumps a quarter stronger.' },
      { cost: 22, label: 'Trained crews', effect: 'Two more parties; pumps half as strong again.' },
    ],
  },
  {
    id: 'dazzle',
    name: 'Dazzle paint',
    blurb: 'Angular patches of black, white and blue-grey that break up her lines, as the fleet was painted from 1917. It does not hide her: it makes her heading and her speed hard to judge.',
    levels: [{ cost: 14, label: 'Dazzle scheme', effect: 'The enemy’s range and bearing readings are worse at long range (up to a third worse beyond 9 km), and no worse inside 3 km.' }],
    after: { mission: 'run-to-the-south', text: 'The Admiralty takes up dazzle painting after Jutland: open “Run to the South” first.' },
  },
];

export function noRefits(): RefitLevels {
  return { rangefinder: 0, flash: 0, bulges: 0, 'damage-control': 0, dazzle: 0 };
}

export function refitDef(id: RefitId): RefitDef {
  return REFITS.find((r) => r.id === id)!;
}

/** The cost of the next level of a refit, or null when it is fully fitted. */
export function nextRefitCost(id: RefitId, level: number): number | null {
  return refitDef(id).levels[level]?.cost ?? null;
}

const FLASH = [0, 0.5, 0.85] as const;
const BULGES = [0, 0.3, 0.5] as const;
const PUMPS = [1, 1.25, 1.5] as const;

/** The ship as she is after her refits: a copy of the setup with the instruments and the damage plan changed. */
export function applyRefits(setup: ShipSetup, levels: RefitLevels): ShipSetup {
  const rf = levels.rangefinder;
  // A refit only ever improves on the instrument she has: a ship with a longer one already is not given a shorter.
  const fitted = rf >= 2 ? RANGEFINDER_30FT : rf === 1 ? RANGEFINDER_15FT : null;
  const damage = {
    ...setup.damage,
    flashProtection: Math.max(setup.damage.flashProtection, FLASH[Math.min(levels.flash, 2)]!),
    torpedoProtection: Math.max(setup.damage.torpedoProtection ?? 0, BULGES[Math.min(levels.bulges, 2)]!),
    parties: setup.damage.parties + Math.min(levels['damage-control'], 2),
    pumpTonnesPerSecond: setup.damage.pumpTonnesPerSecond * PUMPS[Math.min(levels['damage-control'], 2)]!,
  };
  return {
    ...setup,
    damage,
    dazzle: levels.dazzle > 0 ? 1 : setup.dazzle,
    rangefinder: fitted && fitted.baseM > setup.rangefinder.baseM ? fitted : setup.rangefinder,
  };
}
