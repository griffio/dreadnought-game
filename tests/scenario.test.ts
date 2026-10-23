import { describe, expect, it } from 'vitest';
import { Battle } from '../src/sim/combat/battle';
import { DEFAULT_VISIBILITY_KM, enemySeed, fightEnvironment, FIRST_ENEMY_ID, PLAYER_ID } from '../src/sim/combat/convention';
import { gameScenario } from '../src/sim/combat/scenario';
import { DEFAULT_WAVE_SPEC } from '../src/sim/ocean/waves';

describe('the game\'s scenarios, headless', () => {
  it('places the torpedo attack as the game does, with the game\'s ids and seeds, and fights it the same way twice', () => {
    const opts = gameScenario({ kind: 'destroyers', seed: 9, destroyers: 2, autoPlayer: 'evade' });
    expect(opts.ships.map((s) => s.side)).toEqual(['player', 'enemy', 'enemy']);
    // A front: the boats a few degrees apart and staggered in range, about nine kilometres off the port bow.
    const ranges = opts.ships.slice(1).map((s) => Math.hypot(s.x, s.z));
    expect(ranges[0]).toBeCloseTo(9000, 0);
    expect(ranges[1]).toBeCloseTo(9700, 0);
    const b = new Battle(opts);
    expect(b.player.id).toBe(PLAYER_ID);
    expect(b.enemies.map((e) => e.id)).toEqual([FIRST_ENEMY_ID, FIRST_ENEMY_ID + 1]);
    expect(b.player.cfg.seed).toBe(9);
    expect(b.enemies.map((e) => e.cfg.seed)).toEqual([enemySeed(9, 0), enemySeed(9, 1)]);
    const again = new Battle(gameScenario({ kind: 'destroyers', seed: 9, destroyers: 2, autoPlayer: 'evade' }));
    for (let i = 0; i < 1200; i++) {
      b.step();
      again.step();
    }
    expect(b.checkpoints.get(1200)).toBe(again.checkpoints.get(1200));
    expect(b.checkpoints.get(1200)).not.toBe(b.checkpoints.get(600));
  });

  it('flies its shells in the game\'s default wind, at the game\'s visibility', () => {
    const env = fightEnvironment(DEFAULT_WAVE_SPEC);
    expect(Math.hypot(env.windX, env.windZ)).toBeCloseTo(11 * 1.15, 6);
    const b = new Battle(gameScenario({ kind: 'duel', seed: 3, autoPlayer: 'steady' }));
    expect(b.player.cfg.env()).toEqual(env);
    expect(b.player.cfg.visibilityKm()).toBe(DEFAULT_VISIBILITY_KM);
  });
});
