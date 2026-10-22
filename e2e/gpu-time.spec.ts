import { expect, test } from './fixtures';

// Logs the per-phase GPU time breakdown for a few views. Not an assertion on speed: it is how we find what to
// optimise. On the dev Mac's Intel iGPU the absolute numbers are high but the proportions are informative.
const VIEWS = [
  { name: 'ship, ocean + sky (bow quarter)', query: 'shot=0&free=1&sun=20&az=40&clouds=0.5' },
  { name: 'sky-heavy (looking up, clouds)', query: 'shot=0&free=1&sun=20&az=40&clouds=0.7&pitch=35&yaw=40&x=0&z=0&cam=28' },
  { name: 'ocean-heavy (looking down)', query: 'ship=0&sun=20&az=40&clouds=0.4&pitch=-35&yaw=40&cam=28' },
  { name: 'no ship, horizon', query: 'ship=0&sun=20&az=40&clouds=0.5&pitch=2&yaw=40&cam=28' },
];

for (const view of VIEWS) {
  test(`gpu time: ${view.name}`, async ({ page }) => {
    await page.goto(`/?hud=0&scale=1&${view.query}`);
    await page.waitForFunction(() => (window.__frames ?? 0) >= 40, undefined, { timeout: 120_000 });
    await page.waitForTimeout(2500);
    const t = await page.evaluate(() => window.__gpuTiming?.() ?? null);
    expect(t).not.toBeNull();
    console.log(
      `${view.name}: sky ${t!.sky.toFixed(2)}  ocean ${t!.ocean.toFixed(2)}  shadow ${t!.shadow.toFixed(2)}  scene ${t!.scene.toFixed(2)}  post ${t!.post.toFixed(2)}  total ${t!.total.toFixed(2)} ms`,
    );
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  });
}
