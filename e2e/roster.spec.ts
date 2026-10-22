import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 90_000 });
}

// Every ship in the roster, seen from the bow quarter and from astern. Screenshots land in test-results/ for inspection.
const SHIPS: { id: string; length: number }[] = [
  { id: 'dreadnought', length: 160 },
  { id: 'queen-elizabeth', length: 197 },
  { id: 'rodney', length: 217 },
  { id: 'king-george-v', length: 227 },
  { id: 'kaiser', length: 172 },
  { id: 'bismarck', length: 251 },
  { id: 'bismarck-wounded', length: 251 },
];

for (const ship of SHIPS) {
  test(`roster: ${ship.id}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    const views = [
      { name: 'bow', orbit: `40,9,${Math.round(ship.length * 0.62)}` },
      { name: 'stern', orbit: `150,14,${Math.round(ship.length * 0.62)}` },
      { name: 'beam', orbit: `90,5,${Math.round(ship.length * 0.8)}` },
    ];
    for (const v of views) {
      await page.goto(`/?hud=0&freeze=55&scale=1&target=0&player=${ship.id}&orbit=${v.orbit}&sun=24&az=40&clouds=0.35&wind=8&tele=0`);
      await waitForFrames(page, 14);
      await page.screenshot({ path: `test-results/roster-${ship.id}-${v.name}.png` });
      expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
}
