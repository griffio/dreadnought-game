import { expect, test } from './fixtures';

test('boots, renders frames, no GPU errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));

  await page.goto('/');
  await expect(page.locator('.hud')).toContainText('fps', { timeout: 20_000 });
  await page.waitForTimeout(1500);

  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
  await page.screenshot({ path: 'test-results/boot.png' });
});

test('GPU probe: every check passes and reports a tier', async ({ page }) => {
  await page.goto('/?probe');
  const panel = page.locator('.probe-output');
  await expect(panel).toContainText('suggested tier', { timeout: 90_000 });

  const text = await panel.innerText();
  console.log(text.split('\n--- report ---')[0]);
  expect(text).toContain('PASS ocean-field self-test');
  expect(text).not.toMatch(/\bFAIL\b/);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
});
