import { shipById, type ShipId } from '../../data/ships/roster';
import { pacedProfile, pacedSetup, REAL, type Pace } from '../pace';
import { AGGRESSIVE, CLOSING_GUNNER, STEADY_GUNNER, type AiProfile } from './ai';
import type { BattleOptions, BattleShip } from './battle';

const DEG = Math.PI / 180;

/** The game's scenarios, as its front door and URL set them up (see app/game.ts: DEFAULT_SCENARIO, DESTROYER_SCENARIO, placeEnemy). */
export interface GameScenario {
  kind: 'duel' | 'destroyers';
  seed: number;
  /** Who sails the player's ship: a gunner who keeps his distance, one who closes, or the bot that turns toward torpedoes. */
  autoPlayer: 'steady' | 'closing' | 'evade';
  player?: ShipId;
  foe?: ShipId;
  destroyers?: number;
  escorts?: number;
  rangeKm?: number;
  bearingDeg?: number;
  headingDeg?: number;
  enemyProfile?: AiProfile;
  pace?: Pace;
}

/**
 * The game's duel or torpedo attack, headless: the same ships placed as the game places them about a player at the origin heading
 * north and lying stopped, with the same brains. With the conventions in convention.ts, a seed then gives the fight the game gives.
 */
export function gameScenario(s: GameScenario): BattleOptions {
  const pace = s.pace ?? REAL;
  const destroyer = shipById('destroyer');
  const fleet = s.kind === 'destroyers' ? Array.from({ length: Math.max(s.destroyers ?? 2, 1) }, () => destroyer) : [shipById(s.foe, 'hessen'), ...Array.from({ length: s.escorts ?? 0 }, () => destroyer)];
  const rangeKm = s.rangeKm ?? (s.kind === 'destroyers' ? 9 : 12);
  const bearingDeg = s.bearingDeg ?? -18;
  const n = fleet.length;
  const playerEntry = shipById(s.player);
  const ships: BattleShip[] = [
    {
      setup: pacedSetup(playerEntry.setup, pace),
      side: 'player',
      x: 0,
      z: 0,
      headingDeg: 0,
      brain: s.autoPlayer === 'evade' ? { kind: 'player-bot', evasion: 'head-on' } : { kind: 'duel', profile: s.autoPlayer === 'steady' ? STEADY_GUNNER : CLOSING_GUNNER },
      // The game's player begins at anchor; her captain rings down for speed on his first thought.
      startKnots: 0,
      startTelegraph: 0,
    },
  ];
  fleet.forEach((entry, i) => {
    // A flotilla comes in on a front, a few degrees apart and a little staggered in range; a ship of the line comes on the bearing,
    // with her escort out on either bow of her, a mile or so nearer.
    const escort = s.kind === 'duel' && i > 0;
    const side = (i - 1) % 2 === 0 ? -1 : 1;
    const offset = s.kind === 'duel' ? (escort ? side * (14 + Math.floor((i - 1) / 2) * 10) : 0) : (i - (n - 1) / 2) * 26;
    const bearing = (bearingDeg + offset) * DEG;
    const range = s.kind === 'duel' ? rangeKm * 1000 - (escort ? 1500 : 0) : rangeKm * 1000 + i * 700;
    const x = Math.sin(bearing) * range;
    const z = -Math.cos(bearing) * range;
    const towards = (((Math.atan2(-x, z) / DEG) % 360) + 360) % 360;
    ships.push({
      setup: pacedSetup(entry.setup, pace),
      side: 'enemy',
      x,
      z,
      headingDeg: s.headingDeg ?? towards,
      brain: entry.id === 'destroyer' ? { kind: 'destroyer' } : { kind: 'duel', profile: pacedProfile(s.enemyProfile ?? entry.profile ?? AGGRESSIVE, pace) },
    });
  });
  return { seed: s.seed, ships };
}
