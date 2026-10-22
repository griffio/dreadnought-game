import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 90_000 });
}

// A whole fight in the browser, with the player's ship under the autopilot and the clock running fast.
test('duel: a full fight runs to a result with no errors, and the damage shows', async ({ page }) => {
  test.setTimeout(420_000);
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.goto('/?auto=closing&tscale=8&designate=1&autospot=1&trange=9&tbrg=-18&gseed=5&sun=24&az=300&clouds=0.4&wind=8&scale=0.75');
  await waitForFrames(page, 10);

  const seen = new Set<string>();
  const shoot = async (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    await page.screenshot({ path: `test-results/duel-${name}.png` });
  };
  const start = Date.now();
  let outcome: unknown = null;
  while (Date.now() - start < 380_000) {
    const s = await page.evaluate(() => {
      const g = window.__game!;
      const e = g.enemy!.combatant.damage;
      return {
        outcome: g.outcome,
        enemy: e.status,
        fires: e.fires,
        flooded: e.floodedTonnes,
        list: e.list,
        t: g.simTime,
        player: g.playerCombatant.damage.status,
        particles: window.__sea!.fx.particles.active,
      };
    });
    if (s.fires > 0) await shoot('enemy-fire');
    if (s.flooded > 400) await shoot('enemy-flooding');
    if (s.enemy === 'sinking' || s.enemy === 'exploded') await shoot('enemy-going-down');
    if (s.enemy === 'struck') await shoot('enemy-struck');
    if (s.outcome) {
      outcome = s.outcome;
      await page.waitForTimeout(600);
      await shoot('result');
      break;
    }
    await page.waitForTimeout(1500);
  }
  expect(outcome).not.toBeNull();
  expect((outcome as { result: string }).result).toBe('victory');
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.rtitle')).toHaveText('VICTORY');
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});
