import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

test('campaign: the front door lists the sorties, locks the later ones, and sails the first with its orders', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto('/?scale=0.5');
  await waitForFrames(page, 10);
  await expect(page.locator('.menu')).toBeVisible();
  await expect(page.locator('.mcard')).toHaveCount(7);
  await expect(page.locator('.mprestige b')).toHaveText('0');
  // The fight's own HUD is out of the way.
  await expect(page.locator('.helm')).toBeHidden();
  await expect(page.locator('.gcard')).toBeHidden();
  // Only the first sortie is open.
  await expect(page.locator('.mcard[data-locked="1"]')).toHaveCount(5);
  // A new player is sent to the gunnery school first, which is not one of the sorties and locks nothing.
  await expect(page.locator('.mdetail .dhead')).toHaveText('GUNNERY SCHOOL');
  await page.locator('.mcard[data-id="trials"]').click();
  await expect(page.locator('.mdetail .dhead')).toHaveText('ADMIRALTY TRIALS');
  await expect(page.locator('.dbrief')).toContainText('SMS Hessen');
  await page.locator('.mcard[data-id="narrows"]').click();
  await expect(page.locator('.mdetail .dhead')).toHaveText('THE NARROWS');
  await expect(page.locator('.msail')).toBeDisabled();
  await expect(page.locator('.dlock')).toContainText('Win');
  await page.screenshot({ path: 'test-results/campaign-menu.png' });
  // Each sortie names her ship, and the ship at anchor is hers.
  await expect(page.locator('.dship b')).toContainText('Queen Elizabeth');
  expect(await page.evaluate(() => window.__game!.playerEntry.id)).toBe('dreadnought');
  await page.locator('.mcard[data-id="last-stand"]').click();
  await expect(page.locator('.mdetail .dhead')).toHaveText("BISMARCK'S LAST STAND");
  await expect(page.locator('.dship b')).toContainText('Rodney');
  await expect(page.locator('.dfoe')).toContainText('Bismarck');
  await expect(page.locator('.msub')).toContainText('RODNEY');
  await waitForFrames(page, 4);
  await page.screenshot({ path: 'test-results/campaign-menu-rodney.png' });

  await page.locator('.mcard[data-id="trials"]').click();
  await expect(page.locator('.msail')).toBeEnabled();
  await Promise.all([page.waitForURL(/mission=trials/), page.locator('.msail').click()]);
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => document.body.dataset.menu)).toBe('0');
  await expect(page.locator('.menu')).toHaveCount(0);
  await expect(page.locator('.mline', { hasText: 'ORDERS' })).toBeVisible();
  expect(await page.evaluate(() => window.__game!.kind)).toBe('duel');
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('campaign: a won sortie is marked, opens the next, and the prestige buys a refit that the ship then carries', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto('/?mission=trials&gseed=3&scale=0.5');
  await waitForFrames(page, 10);
  // As built: the nine-foot rangefinder.
  expect(await page.evaluate(() => window.__game!.playerCombatant.cfg.rangefinder.baseM)).toBeCloseTo(2.74, 2);
  // End the sortie with a win (the fight itself is covered by the duel specs).
  await page.evaluate(() => {
    window.__game!.outcome = {
      result: 'victory',
      how: 'SMS Hessen struck her colours.',
      seconds: 700,
      shellsFired: 60,
      hitsScored: 8,
      hitsTaken: 3,
      dishonour: 0,
      condition: 0.9,
      disabled: false,
      torpedoes: null,
      shore: null,
    };
  });
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.rprestige b')).toContainText('PRESTIGE +');
  const earned = await page.evaluate(() => window.__campaign!.prestige);
  expect(earned).toBeGreaterThanOrEqual(14);
  await page.screenshot({ path: 'test-results/campaign-result.png' });

  await page.getByRole('button', { name: 'Return to port' }).click();
  await page.waitForURL(/menu=1/);
  await waitForFrames(page, 10);
  await expect(page.locator('.mprestige b')).toHaveText(String(earned));
  await expect(page.locator('.mcard[data-id="torpedo-boats"]')).toHaveAttribute('data-locked', '0');
  await expect(page.locator('.mcard[data-id="narrows"]')).toHaveAttribute('data-locked', '1');
  await expect(page.locator('.mcard[data-id="trials"] .mstate')).toHaveText('WON x1');

  // The dry dock: buy the first rangefinder refit.
  await page.getByRole('button', { name: 'DRY DOCK' }).click();
  await expect(page.locator('.drefit')).toHaveCount(4);
  const row = page.locator('.drefit[data-id="rangefinder"]');
  await expect(row.locator('.dbuy')).toBeEnabled();
  await row.locator('.dbuy').click();
  await expect(row.locator('.dpips i.on')).toHaveCount(1);
  await expect(page.locator('.mprestige b')).toHaveText(String(earned - 14));
  await page.screenshot({ path: 'test-results/campaign-dock.png' });
  // The expensive ones are out of reach until there is more prestige.
  await expect(page.locator('.drefit[data-id="bulges"] .dbuy')).toBeDisabled();

  // Sail again: the ship carries the refit. A plain scenario URL (tests, tuning) is the ship as built.
  await page.getByRole('button', { name: 'SORTIES' }).click();
  // The furthest open sortie is suggested; go back to the first.
  await expect(page.locator('.mdetail .dhead')).toHaveText('TORPEDO BOATS');
  await page.locator('.mcard[data-id="trials"]').click();
  await Promise.all([page.waitForURL(/mission=trials/), page.locator('.msail').click()]);
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => window.__game!.playerCombatant.cfg.rangefinder.baseM)).toBeCloseTo(4.57, 2);
  await page.goto('/?scenario=duel&scale=0.5');
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => window.__game!.playerCombatant.cfg.rangefinder.baseM)).toBeCloseTo(2.74, 2);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`campaign menu ${width}x${height}: the sortie and the dry dock fit, and the buttons can be reached`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await page.goto('/?touch=1&scale=0.5');
    await waitForFrames(page, 10);
    const inView = async (sel: string) => {
      const b = (await page.locator(sel).first().boundingBox())!;
      expect(b.x, sel).toBeGreaterThanOrEqual(-1);
      expect(b.y, sel).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(width + 1);
      expect(b.y + b.height, sel).toBeLessThanOrEqual(height + 1);
    };
    await inView('.msail');
    await inView('.mcard');
    await inView('.mtab');
    await page.screenshot({ path: `test-results/campaign-menu-${width}.png` });
    await page.getByRole('button', { name: 'DRY DOCK' }).click();
    await inView('.drefit');
    await page.screenshot({ path: `test-results/campaign-dock-${width}.png` });
  });
}
