import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * A fight is the same fight at any frame rate. The simulation runs in fixed steps and nothing it reads comes from the frame: the
 * ships float on the waves at the time of their own step, the recoil of the guns is applied there, and the shove of a hit is drawn
 * from the fight's seed. Two runs of one seed that batch their steps differently (a slow and a fast clock) must agree, step for step.
 */
async function checkpoints(page: Page, tscale: number): Promise<Map<number, string>> {
  await page.goto(`/?playtest=arcade-duel&auto=closing&gseed=21&hud=0&scale=0.4&tscale=${tscale}`);
  await page.waitForFunction(() => window.__game?.checkpoints.has(3600) === true, undefined, { timeout: 180_000 });
  return new Map(await page.evaluate(() => [...window.__game!.checkpoints].filter(([tick]) => tick <= 3600)));
}

test('two runs of one seed, at different clock rates, pass the same checkpoints', async ({ page }) => {
  test.setTimeout(420_000);
  const slow = await checkpoints(page, 3);
  const fast = await checkpoints(page, 7);
  expect([...slow.keys()]).toEqual([600, 1200, 1800, 2400, 3000, 3600]);
  for (const [tick, print] of slow) expect(fast.get(tick), `at step ${tick}`).toBe(print);
  // The ships really did move and roll: the fingerprints are not of a ship lying still in a flat calm.
  const last = slow.get(3600)!.split('|')[0]!.split(',').map(Number);
  const [x, z, , speed, heave, pitch, roll] = last;
  expect(Math.hypot(x!, z!)).toBeGreaterThan(100);
  expect(speed).toBeGreaterThan(1);
  expect(Math.abs(heave!) + Math.abs(pitch!) + Math.abs(roll!)).toBeGreaterThan(1e-4);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
});
