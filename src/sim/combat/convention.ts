import type { Environment } from '../gunnery/ballistics';
import type { Combatant } from './combatant';

/**
 * What the game and the headless harnesses must agree on for a seed to mean the same fight in both: who has which id, how each
 * ship's and each brain's seed is drawn from the fight's, the air the shells fly in, how far the lookouts see, and the shape of
 * the fingerprint the fight is checked by.
 */
export const PLAYER_ID = 1;
export const FIRST_ENEMY_ID = 2;
export const FIRST_FORT_ID = 100;
/** Director's eye and sight position when a ship's setup does not say: the foretop, ship space. */
export const DIRECTOR_DEFAULT: readonly [number, number, number] = [17, 25, 0];
/** Wind a little above the 10 m reading acts on a shell at height; the smoke feels roughly the surface wind. */
export const SHELL_WIND_FACTOR = 1.15;
export const LATITUDE_DEG = 52;
/** How far the lookouts see on the game's default day, km. */
export const DEFAULT_VISIBILITY_KM = 45;
/** The enemy's fire-control tables are worked less often than the player's. */
export const ENEMY_SOLVE_PERIOD = 0.5;
/** The fan the player's torpedoes are fired in, degrees. */
export const PLAYER_TORPEDO_SPREAD = 6;
/** A fingerprint of the fight is kept every this many steps (ten seconds). */
export const CHECKPOINT_TICKS = 600;

/** The air the shells fly in and the smoke drifts on: the sea's wind, a little stronger aloft, at the latitude of the North Sea. */
export function fightEnvironment(wind: { windSpeed: number; waveHeadingDeg: number }): Environment {
  const h = (wind.waveHeadingDeg * Math.PI) / 180;
  return {
    windX: Math.sin(h) * wind.windSpeed * SHELL_WIND_FACTOR,
    windZ: -Math.cos(h) * wind.windSpeed * SHELL_WIND_FACTOR,
    coriolisLatitudeDeg: LATITUDE_DEG,
    densityScale: 1,
  };
}

/** The seed of the i-th enemy ship's combatant (its gunnery, damage and jams). */
export const enemySeed = (seed: number, i: number): number => seed + 1 + i * 17;
/** The seed of an enemy ship's captain, from her combatant's. */
export const enemyAiSeed = (shipSeed: number): number => shipSeed ^ 0x51ed;
/** The seed of the player's own captain when a brain sails her (demonstrations and tests). */
export const playerAiSeed = (seed: number): number => seed ^ 0x77;
/** The seed of the i-th shore battery. */
export const fortSeed = (seed: number, i: number): number => seed + 301 + i * 13;

/** The state of the fight in a line: where every ship is and how she lies, and what the guns have done. */
export function fightFingerprint(player: Combatant, enemies: readonly Combatant[], torpedoesInWater: number): string {
  const f = (v: number) => v.toFixed(5);
  const ship = (c: Combatant) => {
    const d = c.dynamics;
    const fr = c.cfg.frame();
    return `${f(d.x)},${f(d.z)},${f(d.heading)},${f(d.speed)},${f(fr.y)},${f(fr.pitch)},${f(fr.roll)}`;
  };
  return [ship(player), ...enemies.map(ship), player.shellsFired, player.hitsScored, player.hitsTaken, torpedoesInWater].join('|');
}
