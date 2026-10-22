import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 90_000 });
}

test('damage: flooding lists the ship the right way, the report shows it, and losing ends the fight', async ({ page }) => {
  test.setTimeout(150_000);
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.goto('/?passive=1&tspd=0&trange=4&tbrg=-30&designate=1&warm=2&sun=26&az=290&clouds=0.4&wind=8&scale=0.75&freeze=40&tscale=4&orbit=160,18,200');
  await waitForFrames(page, 8);

  // The damage report opens with H.
  await expect(page.locator('.dpanel')).toBeHidden();
  await page.keyboard.press('KeyH');
  await expect(page.locator('.dpanel')).toBeVisible();
  await expect(page.locator('.dtitle')).toContainText('HMS DREADNOUGHT');
  await expect(page.locator('.dcell')).toHaveCount(10);

  // Water to starboard: she heels to starboard (positive roll is starboard down).
  await page.evaluate(() => {
    const d = window.__game!.playerCombatant.damage;
    for (const id of ['boiler-1', 'mag-PQ']) {
      const c = d.comps.find((x) => x.spec.id === id)!;
      c.flood = c.spec.capacityT * 0.55;
      c.floodSide = 6;
    }
  });
  await page.waitForTimeout(6000);
  const roll = await page.evaluate(() => window.__player!.instance.pose.roll);
  expect(roll).toBeGreaterThan(0.015);
  await expect(page.locator('.chip', { hasText: 'FLOODING' })).toBeVisible();
  await expect(page.locator('.chip', { hasText: 'STBD' })).toBeVisible();
  const water = await page.locator('.dcell .water').evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.height)));
  expect(Math.max(...water)).toBeGreaterThan(40);
  await page.screenshot({ path: 'test-results/damage-list.png' });
  await page.keyboard.press('KeyH');
  await expect(page.locator('.dpanel')).toBeHidden();

  // Open her to the sea: she goes down, and the fight is lost.
  await page.evaluate(() => {
    const d = window.__game!.playerCombatant.damage;
    for (const c of d.comps) c.flood = c.spec.capacityT * 0.95;
  });
  await page.waitForFunction(() => window.__game!.outcome !== null, undefined, { timeout: 120_000 });
  await expect(page.locator('.rtitle')).toHaveText('DEFEAT');
  await page.screenshot({ path: 'test-results/damage-defeat.png' });
  const state = await page.evaluate(() => ({ status: window.__game!.playerCombatant.damage.status, roll: window.__player!.instance.pose.roll }));
  expect(['sinking', 'sunk']).toContain(state.status);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});
