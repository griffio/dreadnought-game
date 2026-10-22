import { DESTROYER_SETUP, DREADNOUGHT_SETUP } from '../../src/data/ships/fleet';
import { Battle, type BattleShip } from '../../src/sim/combat/battle';
import type { Evasion } from '../../src/sim/combat/player-bot';
import type { DestroyerProfile } from '../../src/sim/combat/destroyer-ai';
import { pacedSetup, paceById } from '../../src/sim/pace';
import { Rng } from '../../src/sim/rng';

export function scenario(seed: number, destroyers: number, evasion: Evasion, profile?: DestroyerProfile): Battle {
  const rng = new Rng(seed * 7919);
  const pace = paceById((globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.PACE);
  const ships: BattleShip[] = [
    { setup: pacedSetup(DREADNOUGHT_SETUP, pace), side: 'player', x: 0, z: 0, headingDeg: rng.next() * 360, brain: { kind: 'player-bot', evasion } },
  ];
  for (let i = 0; i < destroyers; i++) {
    const bearing = rng.next() * Math.PI * 2;
    const range = 9000 + rng.next() * 3000;
    ships.push({
      setup: pacedSetup(DESTROYER_SETUP, pace),
      side: 'enemy',
      x: Math.sin(bearing) * range,
      z: -Math.cos(bearing) * range,
      headingDeg: rng.next() * 360,
      brain: { kind: 'destroyer', profile },
    });
  }
  return new Battle({ seed, ships });
}
