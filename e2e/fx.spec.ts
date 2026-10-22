import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 90_000 });
}

// A look at the gunnery effects close up: splash columns, a hit burst and a broadside's muzzle smoke.
test('fx: splashes, a burst and a broadside', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.goto('/?hud=0&free=1&target=0&x=40&cam=30&z=330&yaw=-8&pitch=4&fov=55&sun=24&az=300&clouds=0.4&wind=8&scale=1&freeze=55&sweep=0&aim=0,6');
  await waitForFrames(page, 10);
  await page.evaluate(() => {
    const fx = window.__sea!.fx;
    fx.shellSplash(-60, -300, 0.305);
    fx.shellSplash(30, -430, 0.305);
    fx.shellSplash(-150, -620, 0.381);
    fx.hitBurst(60, 9, -110, 0.305);
    window.__player!.fire();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/fx-early.png' });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: 'test-results/fx-late.png' });
  const active = await page.evaluate(() => window.__sea!.fx.particles.active);
  expect(active).toBeGreaterThan(20);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('fx: splash columns close up', async ({ page }) => {
  await page.goto('/?hud=0&free=1&target=0&x=0&cam=14&z=150&yaw=-22&pitch=3&fov=60&sun=24&az=300&clouds=0.4&wind=8&scale=1&freeze=55&ship=0');
  await waitForFrames(page, 10);
  await page.evaluate(() => {
    const fx = window.__sea!.fx;
    fx.shellSplash(-110, -170, 0.305);
    fx.shellSplash(-40, -260, 0.305);
    fx.shellSplash(-190, -340, 0.381);
    fx.hitBurst(-75, 8, -215, 0.305);
  });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: 'test-results/fx-splash-a.png' });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: 'test-results/fx-splash-b.png' });
});
