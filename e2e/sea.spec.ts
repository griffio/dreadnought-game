import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 60_000 });
}

test('GPU ocean field reproduces an analytic travelling wave', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.goto('/?hud=0&freeze=1&scale=0.4&ship=0');
  await waitForFrames(page, 2);
  const result = await page.evaluate(() => window.__oceanSelfTest!());
  console.log(result.detail);
  expect(result.ok, result.detail).toBe(true);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

// Visual checks: these write screenshots to test-results/ for inspection; they assert only that nothing errored.
const SHOTS: { name: string; query: string }[] = [
  { name: 'golden-hour', query: 'sun=5&az=250&yaw=250&clouds=0.5&wind=11&cam=28' },
  { name: 'noon', query: 'sun=45&az=160&yaw=200&clouds=0.35&wind=8&cam=28' },
  { name: 'dusk', query: 'sun=-1.5&az=265&yaw=265&clouds=0.4&wind=9&cam=28' },
  { name: 'rough', query: 'sun=18&az=120&yaw=70&clouds=0.9&wind=22&vis=18&cam=28&heading=70' },
  { name: 'low-angle', query: 'sun=12&az=90&yaw=0&pitch=-4&clouds=0.2&wind=14&cam=6' },
];

for (const shot of SHOTS) {
  test(`renders ${shot.name}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(`/?hud=0&freeze=40&scale=1&ship=0&${shot.query}`);
    await waitForFrames(page, 6);
    await page.screenshot({ path: `test-results/sea-${shot.name}.png` });
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    expect(problems).toEqual([]);
  });
}
