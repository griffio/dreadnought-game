import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 90_000 });
}

// Visual checks of HMS Dreadnought from the preset cameras. Screenshots land in test-results/ for inspection.
const SHOTS: { name: string; query: string }[] = [
  { name: 'bow-quarter', query: 'shot=0&sun=22&az=40&clouds=0.35&wind=9' },
  { name: 'beam', query: 'shot=1&sun=26&az=170&clouds=0.3&wind=8' },
  { name: 'stern-quarter-golden', query: 'shot=2&sun=6&az=230&clouds=0.5&wind=10' },
  { name: 'bridge', query: 'shot=3&sun=30&az=90&clouds=0.3&wind=8' },
  { name: 'low', query: 'shot=5&sun=12&az=120&clouds=0.4&wind=11' },
  { name: 'turret-closeup', query: 'shot=4&sun=25&az=60&clouds=0.3&wind=8&aim=30,11' },
  { name: 'shadow', query: 'shot=1&sun=16&az=270&clouds=0.2&wind=7' },
  { name: 'salvo', query: 'shot=0&sun=22&az=40&clouds=0.35&wind=9&sweep=1&fire=0.2' },
];

for (const shot of SHOTS) {
  test(`ship: ${shot.name}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(`/?hud=0&freeze=55&scale=1&free=1&${shot.query}`);
    await waitForFrames(page, 12);
    await page.screenshot({ path: `test-results/ship-${shot.name}.png` });
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    expect(problems).toEqual([]);
  });
}
