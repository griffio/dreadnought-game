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

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

test('arcade duel: the front door offers it, and it opens a real one-on-one fight at the quicker pace', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto('/?scale=0.5');
  await waitForFrames(page, 10);
  await page.locator('.mcard[data-id="arcade-duel"]').click();
  await expect(page.locator('.mdetail .dhead')).toHaveText('ARCADE DUEL');
  await expect(page.locator('.dship b')).toContainText('Queen Elizabeth');
  await expect(page.locator('.dfoe')).toContainText('Kaiser');
  await expect(page.locator('.dinfo')).toContainText('Playtest');
  await Promise.all([page.waitForURL(/playtest=arcade-duel/), page.locator('.msail').click()]);
  await waitForFrames(page, 10);

  expect(await page.evaluate(() => document.body.dataset.menu)).toBe('0');
  expect(await page.evaluate(() => document.body.dataset.pace)).toBe('arcade');
  expect(await page.evaluate(() => document.body.dataset.tutorial)).toBe('0');
  expect(await page.evaluate(() => window.__game!.kind)).toBe('duel');
  expect(await page.evaluate(() => window.__game!.enemies.length)).toBe(1);
  // Queen Elizabeth's 24 knots, wound on.
  expect(await page.evaluate(() => window.__player!.dynamics.handling.maxSpeedKn)).toBeCloseTo(36, 3);
  // Her guns reload in half the time: 22 s in the data file.
  expect(await page.evaluate(() => window.__game!.playerCombatant.batteries[0]!.setup.gun.reloadSeconds)).toBeCloseTo(11, 3);
  await expect(page.locator('.mline', { hasText: 'ARCADE PACE' })).toBeVisible();
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('arcade duel: the ship really does gather way and turn faster than at the real pace', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  // The same ship, full ahead, hard over, at ten times the clock: heading after a minute of sim time.
  const sail = async (extra: string) => {
    await page.goto(`/?scenario=duel&player=queen-elizabeth&target=0&tele=3&rud=1&tscale=10&scale=0.5${extra}`);
    await waitForFrames(page, 10);
    await page.waitForFunction(() => window.__game!.simTime >= 30, undefined, { timeout: 120_000 });
    return page.evaluate(() => ({ kn: window.__player!.dynamics.speedKnots, yawRate: Math.abs(window.__player!.dynamics.yawRate), t: window.__game!.simTime }));
  };
  const real = await sail('');
  expect(await page.evaluate(() => window.__game!.pace.id)).toBe('real');
  const arcade = await sail('&pace=arcade');
  expect(await page.evaluate(() => window.__game!.pace.id)).toBe('arcade');
  // Quicker to speed: the real ship is still gathering way at half-way through; the arcade one is up to speed.
  expect(arcade.kn).toBeGreaterThan(real.kn * 1.3);
  // And it swings round faster once it is there.
  expect(arcade.yawRate).toBeGreaterThan(real.yawRate * 1.8);
  expect(problems).toEqual([]);
});

test('arcade duel: a whole fight, steamed by the auto-player at ten times the clock, is over in minutes and ends with a result', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watch(page);
  await page.goto('/?playtest=arcade-duel&auto=closing&tscale=10&gseed=21&scale=0.5');
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.simTime >= 60, undefined, { timeout: 120_000 });
  await page.screenshot({ path: 'test-results/arcade-duel-midfight.png' });
  await page.waitForFunction(() => window.__game!.outcome !== null || window.__game!.simTime > 900, undefined, { timeout: 240_000 });
  const end = await page.evaluate(() => ({ outcome: window.__game!.outcome?.result ?? null, how: window.__game!.outcome?.how ?? '', t: window.__game!.simTime, shells: window.__game!.playerCombatant.shellsFired }));
  // Somebody was beaten, in well under the quarter of an hour a realistic duel takes, and the guns were used.
  expect(end.outcome, end.how).not.toBeNull();
  expect(end.t).toBeLessThan(600);
  expect(end.shells).toBeGreaterThan(10);
  await expect(page.locator('.result')).toBeVisible();
  await page.screenshot({ path: 'test-results/arcade-duel-result.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('arcade duel: a finished fight shows its result, pays nothing and records nothing', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto('/?playtest=arcade-duel&gseed=5&scale=0.5');
  await waitForFrames(page, 10);
  await page.evaluate(() => {
    window.__game!.outcome = {
      result: 'victory',
      how: 'SMS Kaiser struck her colours.',
      seconds: 150,
      shellsFired: 60,
      hitsScored: 9,
      hitsTaken: 4,
      dishonour: 0,
      condition: 0.8,
      disabled: false,
      torpedoes: null,
      shore: null,
    };
  });
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.rprestige')).toBeHidden();
  expect(await page.evaluate(() => window.__campaign!.prestige)).toBe(0);
  expect(await page.evaluate(() => Object.keys(window.__campaign!.state.missions).length)).toBe(0);
  await page.getByRole('button', { name: 'Return to port' }).click();
  await page.waitForURL(/menu=1/);
  await waitForFrames(page, 10);
  await expect(page.locator('.mcard[data-id="arcade-duel"]')).toBeVisible();
  await expect(page.locator('.mcard[data-locked="1"]')).toHaveCount(5);
  expect(problems).toEqual([]);
});

test('arcade duel: on a touch screen the front door still fits and the card can be reached', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?touch=1&scale=0.5');
  await waitForFrames(page, 10);
  await page.locator('.mcard[data-id="arcade-duel"]').scrollIntoViewIfNeeded();
  await page.locator('.mcard[data-id="arcade-duel"]').click();
  const sail = (await page.locator('.msail').boundingBox())!;
  expect(sail.x + sail.width).toBeLessThanOrEqual(1025);
  expect(sail.y + sail.height).toBeLessThanOrEqual(769);
  await framesLater(page, 4);
  await page.screenshot({ path: 'test-results/arcade-menu-1024.png' });
});
