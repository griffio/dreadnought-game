import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const waitForFrames = (page: Page, n: number) =>
  page.waitForFunction((count) => (window.__frames ?? 0) >= count, n, { timeout: 90_000 });

// The ship is pre-run (?warm) so a developed wake already trails astern. Screenshots land in test-results/.
const SHOTS = [
  // The default dusk lighting, where the old wake read as a grey streak.
  { name: 'wake-golden', query: 'warm=120&tele=2&orbit=165,12,230&sun=6&az=250&clouds=0.5&wind=11' },
  { name: 'wake-astern', query: 'warm=170&tele=3&orbit=170,14,260&sun=20&az=50&clouds=0.35&wind=8' },
  { name: 'wake-aerial', query: 'warm=170&tele=3&orbit=175,52,520&sun=40&az=60&clouds=0.2&wind=7' },
  { name: 'wake-turning', query: 'warm=230&tele=3&rud=0.7&orbit=140,34,420&sun=35&az=70&clouds=0.2&wind=7' },
  { name: 'bow-wave', query: 'warm=170&tele=3&orbit=40,9,115&sun=28&az=60&clouds=0.3&wind=8' },
  { name: 'stopped', query: 'warm=0&tele=0&orbit=165,14,240&sun=20&az=50&clouds=0.35&wind=8' },
];

for (const shot of SHOTS) {
  test(shot.name, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(`/?hud=0&freeze=60&scale=1&${shot.query}`);
    await waitForFrames(page, 10);
    await page.screenshot({ path: `test-results/${shot.name}.png` });
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    expect(problems).toEqual([]);
  });
}
