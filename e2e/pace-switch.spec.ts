import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

test('pace switch: chosen on the front door for every sortie, remembered, and carried into the sortie', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto('/?scale=0.5');
  await waitForFrames(page, 10);
  // Practice and the playtest have their own pace: no switch on their cards.
  await expect(page.locator('.dpace')).toHaveCount(0);
  await page.locator('.mcard[data-id="arcade-duel"]').click();
  await expect(page.locator('.dpace')).toHaveCount(0);
  await page.locator('.mcard[data-id="trials"]').click();
  await expect(page.locator('.dpace')).toHaveCount(1);
  await expect(page.locator('.dpbtn[data-id="real"]')).toHaveAttribute('data-on', '1');
  await expect(page.locator('.dpbtn[data-id="arcade"]')).toHaveAttribute('data-on', '0');
  await expect(page.locator('.dpnote')).toContainText('quarter of an hour');
  expect(await page.evaluate(() => window.__campaign!.state.pace)).toBe('real');

  // Arcade, for this sortie and every other, and it is remembered.
  await page.locator('.dpbtn[data-id="arcade"]').click();
  await expect(page.locator('.dpbtn[data-id="arcade"]')).toHaveAttribute('data-on', '1');
  await expect(page.locator('.dpnote')).toContainText('few minutes');
  await page.locator('.mcard[data-id="trials"]').click();
  await expect(page.locator('.dpbtn[data-id="arcade"]')).toHaveAttribute('data-on', '1');
  await page.screenshot({ path: 'test-results/pace-switch-menu.png' });
  await Promise.all([page.waitForURL(/mission=trials.*pace=arcade|pace=arcade.*mission=trials/), page.locator('.msail').click()]);
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => window.__game!.pace.id)).toBe('arcade');
  expect(await page.evaluate(() => document.body.dataset.pace)).toBe('arcade');
  expect(await page.evaluate(() => window.__player!.dynamics.handling.maxSpeedKn)).toBeCloseTo(21 * 1.5, 3);
  await expect(page.locator('.mline', { hasText: 'ARCADE PACE' })).toBeVisible();

  // Back at the front door it is still arcade; choose the real pace again and the sortie has no pace parameter at all.
  await page.goto('/?menu=1&scale=0.5');
  await waitForFrames(page, 10);
  await page.locator('.mcard[data-id="trials"]').click();
  await expect(page.locator('.dpbtn[data-id="arcade"]')).toHaveAttribute('data-on', '1');
  await page.locator('.dpbtn[data-id="real"]').click();
  await Promise.all([page.waitForURL(/mission=trials/), page.locator('.msail').click()]);
  await waitForFrames(page, 10);
  expect(page.url()).not.toContain('pace=');
  expect(await page.evaluate(() => window.__game!.pace.id)).toBe('real');
  expect(await page.evaluate(() => window.__player!.dynamics.handling.maxSpeedKn)).toBeCloseTo(21, 3);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

// Every sortie at the arcade pace starts, runs and reports no error: the forts, the aircraft, the destroyers and the escorts all take it.
for (const id of ['trials', 'torpedo-boats', 'narrows', 'run-to-the-south', 'denmark-strait', 'last-stand']) {
  test(`pace switch: the sortie "${id}" runs at the arcade pace`, async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watch(page);
    await page.goto(`/?mission=${id}&pace=arcade&tscale=10&scale=0.5&auto=steady`);
    await waitForFrames(page, 10);
    await page.waitForFunction(() => window.__game!.simTime >= 40, undefined, { timeout: 120_000 });
    expect(await page.evaluate(() => window.__game!.pace.id)).toBe('arcade');
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    expect(problems).toEqual([]);
  });
}

// The extra row must not push the SAIL button off the screen for any sortie, on any of the iPad's sizes.
for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`pace switch ${width}x${height}: the switch and the SAIL button can be reached for every sortie`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await page.goto('/?touch=1&scale=0.5');
    await waitForFrames(page, 10);
    const ids = await page.locator('.mcard').evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.id!));
    for (const id of ids) {
      if (id === 'gunnery-school' || id === 'arcade-duel') continue;
      await page.locator(`.mcard[data-id="${id}"]`).click();
      for (const sel of ['.dpbtn[data-id="real"]', '.dpbtn[data-id="arcade"]', '.msail']) {
        const b = (await page.locator(sel).first().boundingBox())!;
        expect(b.x, `${id} ${sel}`).toBeGreaterThanOrEqual(-1);
        expect(b.y, `${id} ${sel}`).toBeGreaterThanOrEqual(-1);
        expect(b.x + b.width, `${id} ${sel}`).toBeLessThanOrEqual(width + 1);
        expect(b.y + b.height, `${id} ${sel}`).toBeLessThanOrEqual(height + 1);
      }
    }
    await page.screenshot({ path: `test-results/pace-switch-${width}.png` });
  });
}
