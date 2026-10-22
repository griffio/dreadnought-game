import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const waitForFrames = (page: Page, n: number) =>
  page.waitForFunction((count) => (window.__frames ?? 0) >= count, n, { timeout: 90_000 });

test.describe('helm HUD', () => {
  test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

  test('touch layout: wheel, telegraph lever and instruments (screenshot)', async ({ page }) => {
    await page.goto('/?scale=1&freeze=40&warm=90&tele=3&rud=0.35&touch=1&orbit=160,15,250&sun=22&az=60&clouds=0.35');
    await waitForFrames(page, 10);
    await page.screenshot({ path: 'test-results/hud-touch.png' });
    await expect(page.locator('.helm .wheel')).toBeVisible();
    await expect(page.locator('.helm .lever .track')).toBeVisible();
    await expect(page.locator('.instruments')).toBeVisible();
  });
});

test('keyboard layout: instruments and key hints (screenshot)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?scale=1&freeze=40&warm=90&tele=3&orbit=160,15,250&sun=22&az=60&clouds=0.35');
  await waitForFrames(page, 10);
  await page.screenshot({ path: 'test-results/hud-keyboard.png' });
  await expect(page.locator('.hints')).toContainText('W/S engines');
  await expect(page.locator('.helm .wheel')).toBeHidden();
});
