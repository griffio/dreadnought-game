import { expect, test } from './fixtures';
import { Battle } from '../src/sim/combat/battle';
import { gameScenario } from '../src/sim/combat/scenario';

/**
 * A seed means the same fight in the game and in the headless harness. The browser runs the game's duel with the closing captain
 * at the wheel; this test runs the same scenario through the Battle harness, with the game's ids, seeds, wind, sea and visibility,
 * and the two must pass the same checkpoints for the first minute.
 */
for (const [name, url, scenario] of [
  ['the duel, a closing captain', 'scenario=duel&auto=closing', { kind: 'duel', autoPlayer: 'closing' }],
  ['the torpedo attack, two boats, the evading bot', 'scenario=destroyers&dd=2&auto=evade', { kind: 'destroyers', destroyers: 2, autoPlayer: 'evade' }],
] as const) {
  test(`the game and the headless harness fight the same fight for one seed: ${name}`, async ({ page }) => {
    test.setTimeout(300_000);
    const seed = 21;
    const headless = new Battle(gameScenario({ ...scenario, seed }));
    while (!headless.checkpoints.has(3600)) headless.step();

    await page.goto(`/?${url}&gseed=${seed}&hud=0&scale=0.4&tscale=6`);
    await page.waitForFunction(() => window.__game?.checkpoints.has(3600) === true, undefined, { timeout: 180_000 });
    const game = new Map(await page.evaluate(() => [...window.__game!.checkpoints].filter(([tick]) => tick <= 3600)));

    expect([...game.keys()]).toEqual([600, 1200, 1800, 2400, 3000, 3600]);
    for (const [tick, print] of game) expect(headless.checkpoints.get(tick), `at step ${tick}`).toBe(print);
    // Something happened in that minute: the ships moved and guns spoke on one side or the other.
    expect(headless.player.shellsFired + headless.enemies.reduce((n, e) => n + e.shellsFired, 0)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  });
}
