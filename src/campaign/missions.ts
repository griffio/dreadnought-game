import type { ScenarioKind } from '../app/game';
import type { ShipId } from '../data/ships/roster';

/** What a finished sortie reports, as far as the Admiralty's marks go. */
export interface MissionOutcome {
  result: 'victory' | 'defeat';
  /** One line on how it ended. */
  how: string;
  seconds: number;
  shellsFired: number;
  hitsScored: number;
  hitsTaken: number;
  /** Shells fired at a ship that had struck her colours. */
  dishonour: number;
  /** How fit the ship is at the end, 0..1: the crew that is left, the water aboard, the power she has. */
  condition: number;
  /** The enemy was left afloat and helpless rather than sunk or surrendered. */
  disabled?: boolean;
}

export interface MissionDef {
  id: string;
  /** Short name and the year of the sortie. */
  title: string;
  year: number;
  place: string;
  scenario: ScenarioKind;
  /** The ship she commands (default: HMS Dreadnought). */
  ship?: ShipId;
  /** The orders: a few paragraphs. */
  briefing: readonly string[];
  /** The one line that decides it, and what to watch for. */
  objective: string;
  hints: readonly string[];
  /** The Admiralty's marks: prestige for a win, and the time that earns a bonus. */
  basePrestige: number;
  parSeconds: number;
  /** The Admiralty wants the enemy taken or disabled, not sent to the bottom: disabling her earns marks. */
  prefersDisabling?: boolean;
  /** Practice, not a sortie: no prestige, never locked, and nothing to win. */
  practice?: boolean;
  /** URL parameters that set the scenario up (merged under whatever the player's own URL says). */
  params?: Record<string, string>;
}

export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'trials',
    title: 'Admiralty Trials',
    year: 1907,
    place: 'The North Sea',
    scenario: 'duel',
    briefing: [
      'The Admiralty has built a ship that makes every other battleship in the world obsolete, and now wants to be sure that she can use her guns. Ten twelve-inch guns can sink anything afloat, if they can be pointed at it.',
      'Intelligence reports an elderly German pre-dreadnought, SMS Hessen, standing across your bows. She is slower than you, armed with an odd mixture of guns, and her captain is known to be brave. Her heavy shells will not get through your armour at a distance, but her casemate guns will make a mess of your upperworks.',
      'You are free to choose the range. Your guns outrange hers, but at long range every salvo takes half a minute to arrive.',
    ],
    objective: 'Sink SMS Hessen, or compel her to strike her colours.',
    hints: ['Click her to designate, then fire. Let the plot settle before you trust the range.', 'Spot the fall of shot and correct. The penetration ruler shows where your shells get through.', 'A ship that has struck is not to be fired on.'],
    basePrestige: 10,
    parSeconds: 1100,
  },
  {
    id: 'torpedo-boats',
    title: 'Torpedo Boats',
    year: 1914,
    place: 'The Heligoland Bight',
    scenario: 'destroyers',
    briefing: [
      'War has come, and with it the weapon that dreadnoughts fear most. The German flotilla has sent its torpedo boats out to find a battleship that is steaming alone.',
      'They will come in fast, from two bearings, behind their own smoke if they can make it, fire a fan of torpedoes at three thousand yards and turn away. Your twelve-pounders will pick them out as they come, but the guns will not stop them all.',
      'A torpedo that you see in time is a torpedo you can avoid. Watch the sea, and when the wakes appear, turn toward them.',
    ],
    objective: 'Beat off the torpedo attack: sink the boats, drive them off, and keep your ship.',
    hints: ['The twelve-pounders fire by themselves at anything small that comes within reach.', 'Turn toward a wake to present the narrowest target. The chart shows each track.', 'F puts the tubes in hand if you want to fire back.'],
    basePrestige: 15,
    parSeconds: 900,
    params: { dd: '2' },
  },
  {
    id: 'narrows',
    title: 'The Narrows',
    year: 1915,
    place: 'The Dardanelles',
    scenario: 'narrows',
    ship: 'queen-elizabeth',
    briefing: [
      'The fleet is to force the Narrows, and the newest ship in it, HMS Queen Elizabeth, has been sent with her eight 15-inch guns to do it. The strait runs north between hills crowned with batteries; its throat is two kilometres wide and commanded by forts on both shores. The Turks have mined it, and the charts do not show where.',
      'The forts on the high ground are hard to hit with flat fire, and some of their guns lie behind the ridge where no ship can see them. Your aircraft can. Put it up, find them, and let it spot your fall of shot.',
      'Armour-piercing shells will not get through concrete at a distance, and the heavy fort at the throat can hurt you badly. Keep their heads down with near misses, run the throat, then close the range.',
    ],
    objective: 'Silence every battery in the Narrows.',
    hints: ['K puts the spotter up. It finds hidden batteries and marks mines below it.', 'Shoals and mines are on the chart once they are seen. Back off if you ground.', 'Shells falling close keep a battery quiet even when they do not destroy it.'],
    basePrestige: 30,
    parSeconds: 3000,
  },
  {
    id: 'run-to-the-south',
    title: 'Run to the South',
    year: 1916,
    place: 'The North Sea, off Jutland',
    scenario: 'duel',
    ship: 'queen-elizabeth',
    briefing: [
      'The battle cruisers have turned for home with the Germans on their heels, and the fast battleships of the Fifth Battle Squadron are all that stand between them and the High Seas Fleet. The visibility is not what it was this morning: there is haze to the east, and the enemy comes out of it.',
      'SMS Kaiser leads the German line, with two torpedo boats in front of her to spoil your aim and fire a fan if they get the chance. She is nearly your equal on armour and she shoots very well, with ten flat-trajectory 30.5 cm guns to your eight 15-inch.',
      'You have the speed to choose the range, and the heavier shell. A 15-inch shell that gets through will end the argument. Her casemate guns reach you at six miles; keep her beyond that, and watch the water for the torpedo boats.',
    ],
    objective: 'Beat SMS Kaiser and her escort: sink them, make them strike, or drive them off.',
    hints: [
      'The 6-inch casemates will engage the torpedo boats by themselves. Keep your heavy guns on the Kaiser.',
      'The penetration ruler shows where your shells get through her. Beyond four miles her belt is proof against you, but her upper side is not.',
      'Turn toward a torpedo wake, and cover a turn with smoke (G).',
    ],
    basePrestige: 45,
    parSeconds: 1800,
    params: { foe: 'kaiser', esc: '2', trange: '15', tbrg: '-20', vis: '22' },
  },
  {
    id: 'denmark-strait',
    title: 'Denmark Strait',
    year: 1941,
    place: 'The North Atlantic',
    scenario: 'duel',
    ship: 'king-george-v',
    briefing: [
      'Hood is gone, in one salvo, and the Bismarck has come through the strait with the Prince of Wales hit and falling back. The Commander-in-Chief has put the fleet at sea and sent the King George V ahead to make contact. She is so new that her quadruple turrets have never fired in earnest.',
      'Bismarck has the best gunnery in the world and she shoots at once. Her belt and deck are proof against your 14-inch shell at any range where she cannot also hit you; only her upper side can be reached from a distance. Your ship is faster than she looks, and her radar reads the range through the haze.',
      'Expect the turrets to jam. Fight with what remains: when one quadruple mounting is down, the other keeps firing. A burst in her machinery or her steering will do more than a dozen on the belt.',
    ],
    objective: 'Stop the Bismarck: sink her, or cripple her so she cannot run.',
    hints: [
      'Keep moving. A fast ship on a changing course is far harder to hit than a slow one on a steady heading.',
      'When a turret jams the crew clear it in a minute or so. The damage view shows which turrets are out.',
      'She will open the range and fight at it. Her flat, fast shells punish a ship that holds a steady course.',
    ],
    basePrestige: 60,
    parSeconds: 1500,
    params: { foe: 'bismarck', trange: '20', tbrg: '-15', vis: '30' },
  },
  {
    id: 'last-stand',
    title: "Bismarck's Last Stand",
    year: 1941,
    place: 'The North Atlantic, 400 miles from Brest',
    scenario: 'duel',
    ship: 'rodney',
    briefing: [
      'A Swordfish torpedo has jammed the Bismarck\'s rudder and she can only steam in a circle, at nine knots, for France. At dawn the battleships close in: the Rodney first, with nine 16-inch guns that no German ship can match for weight of shell, but blind astern and slow to turn.',
      'She has lost two of her turrets in the night, and some of her fire control, but the two that remain are still deadly and she will not strike her colours. Her admiral has made it clear that she will fight until she is sunk.',
      'The Admiralty would rather have her afloat and helpless than on the bottom: a disabled battleship can be examined. Silence her guns, stop her engines and she is ours; the sea will do the rest.',
    ],
    objective: 'Silence the Bismarck. She will not surrender: cripple her, or sink her.',
    hints: [
      'All nine guns point forward. Bring the target onto the bow and keep her there.',
      'Her belt and deck are proof against you at long range. Her upper side is not, and nor are her turrets.',
      'A ship that is crippled with her guns out of action counts as disabled, which the Admiralty prefers to a sinking.',
    ],
    basePrestige: 80,
    parSeconds: 1500,
    prefersDisabling: true,
    params: { foe: 'bismarck-wounded', trange: '14', tbrg: '-10', vis: '30' },
  },
];

/** Training: always open, outside the campaign's order, and it pays nothing. */
export const PRACTICE: readonly MissionDef[] = [
  {
    id: 'gunnery-school',
    title: 'Gunnery School',
    year: 1907,
    place: 'The Gunnery Range',
    scenario: 'duel',
    practice: true,
    briefing: [
      'Before the Admiralty puts a ship in your hands, the gunnery school will teach you what a battleship’s guns actually do. A target ship, SMS Hessen, is steaming across your bows at six knots. She will not fire back.',
      'A coach walks you through the whole chain, one step at a time: picking a target, letting the plot settle, firing, reading the fall of shot, correcting, bracketing the target, letting the gunnery officer spot for you, using the director’s sight, and choosing your range by the penetration ruler.',
      'Each step completes itself when you do it, so you can go as fast as you like. There is nothing to win and nothing to lose, and you can leave at any time.',
    ],
    objective: 'Follow the coach: designate, plot, fire, spot and correct until three shells have hit.',
    hints: ['You never aim a crosshair at the target: you pick the ship and the fire-control table does the rest.', 'Shells take fifteen seconds or more to arrive, so correct from what the splashes show.', 'The coach adapts its words to keyboard, gamepad or touch.'],
    basePrestige: 0,
    parSeconds: 0,
    params: { passive: '1', tspd: '6', tcrs: '70', trange: '9', tbrg: '-18' },
  },
];

export function practiceById(id: string | null | undefined): MissionDef | null {
  return PRACTICE.find((m) => m.id === id) ?? null;
}

export function missionById(id: string | null | undefined): MissionDef | null {
  return MISSIONS.find((m) => m.id === id) ?? null;
}

export interface ScoreLine {
  label: string;
  /** Fraction of the base prestige it adds (negative for a deduction). */
  fraction: number;
}

export interface MissionScore {
  prestige: number;
  lines: ScoreLine[];
}

/**
 * The Admiralty's marks for a sortie: the base for a win, with bonuses for gunnery that hit, a ship brought home in good
 * order, a quick finish and a clean conscience; and a quarter of the base for a ship lost, so that a failure still pays for a
 * refit. Fired on a ship that had struck, shells cost marks.
 */
export function scoreMission(mission: MissionDef, o: MissionOutcome): MissionScore {
  if (o.result === 'defeat') {
    return { prestige: Math.max(Math.round(mission.basePrestige * 0.25), 2), lines: [{ label: 'The ship was lost: the dockyard still pays for the attempt', fraction: 0.25 }] };
  }
  const lines: ScoreLine[] = [{ label: 'Sortie won', fraction: 1 }];
  const accuracy = o.shellsFired > 0 ? o.hitsScored / o.shellsFired : 0;
  if (accuracy >= 0.08) lines.push({ label: `Good gunnery: ${(accuracy * 100).toFixed(0)}% of shells struck`, fraction: 0.15 });
  if (o.condition >= 0.75) lines.push({ label: 'Brought home in good order', fraction: 0.25 });
  else if (o.condition >= 0.5) lines.push({ label: 'Brought home, hurt', fraction: 0.1 });
  if (o.seconds <= mission.parSeconds) lines.push({ label: 'Finished inside the time', fraction: 0.15 });
  if (mission.prefersDisabling && o.disabled) lines.push({ label: 'The enemy left afloat and helpless, as the Admiralty wished', fraction: 0.3 });
  if (o.dishonour > 0) lines.push({ label: `Fired on a ship that had struck: ${o.dishonour} shell${o.dishonour === 1 ? '' : 's'}`, fraction: -0.25 });
  else if (/struck/i.test(o.how)) lines.push({ label: 'Chivalry: the colours were honoured', fraction: 0.1 });
  const total = lines.reduce((s, l) => s + l.fraction, 0);
  return { prestige: Math.max(Math.round(mission.basePrestige * total), 1), lines };
}
