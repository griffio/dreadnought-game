import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

/** Wait for this many more frames than have been rendered so far (waitForFrames counts from page load). */
async function framesLater(page: Page, count: number): Promise<void> {
  const now = await page.evaluate(() => window.__frames ?? 0);
  await waitForFrames(page, now + count);
}

const particles = (page: Page) => page.evaluate(() => ({ active: window.__sea!.fx.particles.active, drawn: window.__sea!.fx.particles.drawn }));

test('funnel smoke: drawn from the chase camera, cleared from the director’s sight, and gun smoke still shows in it', async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));

  // Under way for forty seconds, so both ships have a plume. The target is a passive one that never fires, so no gun has been fired
  // and all the smoke there is is funnel smoke.
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=14&tcrs=0&tele=3&tscale=10&gseed=3&scale=0.5');
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.simTime >= 40, undefined, { timeout: 120_000 });
  await framesLater(page, 4);
  const chase = await particles(page);
  expect(chase.active).toBeGreaterThan(20);
  expect(chase.drawn).toBe(chase.active);
  await page.screenshot({ path: 'test-results/funnel-smoke-chase.png' });

  // The same, with the sight held up: the funnel smoke fades out, and every particle left is of another kind (none here yet).
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=14&tcrs=0&tele=3&tscale=10&gseed=3&scale=0.5&sightup=1&designate=1');
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.simTime >= 40, undefined, { timeout: 120_000 });
  await framesLater(page, 30);
  const sight = await particles(page);
  expect(sight.active).toBeGreaterThan(20);
  expect(sight.drawn).toBe(0);
  await page.screenshot({ path: 'test-results/funnel-smoke-sight.png' });

  // A salvo's own smoke and flash are not funnel smoke: they still show in the sight.
  await page.evaluate(() => window.__player!.fire());
  await framesLater(page, 6);
  const fired = await particles(page);
  expect(fired.drawn).toBeGreaterThan(5);
  expect(fired.drawn).toBeLessThan(fired.active);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});
