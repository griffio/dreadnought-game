import { expect, test } from './fixtures';

// Not a pass/fail benchmark: logs frames per second for each quality setting so regressions and
// device differences are visible. The Dreadnought is in frame, so this includes ship and shadow cost. Run on a quiet machine; headless Chrome on the dev Mac's Intel iGPU is a floor.
const CONFIGS = [
  { name: 'ocean 256, msaa 4, scale 1.0', query: 'q=A&msaa=4&scale=1' },
  { name: 'ocean 256, msaa 1, scale 1.0', query: 'q=A&msaa=1&scale=1' },
  { name: 'ocean 128, msaa 4, scale 1.0', query: 'q=B&msaa=4&scale=1' },
  { name: 'ocean 128, msaa 1, scale 0.6', query: 'q=B&msaa=1&scale=0.6' },
];

for (const cfg of CONFIGS) {
  test(`fps: ${cfg.name}`, async ({ page }) => {
    await page.goto(`/?hud=0&sun=20&az=40&shot=0&free=1&${cfg.query}`);
    await page.waitForFunction(() => (window.__frames ?? 0) >= 5, undefined, { timeout: 60_000 });
    const start = await page.evaluate(() => ({ frames: window.__frames ?? 0, t: performance.now() }));
    await page.waitForTimeout(4000);
    const end = await page.evaluate(() => ({ frames: window.__frames ?? 0, t: performance.now() }));
    const fps = ((end.frames - start.frames) * 1000) / (end.t - start.t);
    console.log(`${cfg.name}: ${fps.toFixed(1)} fps (${(1000 / fps).toFixed(1)} ms/frame)`);
    expect(end.frames).toBeGreaterThan(start.frames);
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  });
}

// The gunnery scene: chase camera, a designated target, HUD on, and the sight up.
const GUNNERY = [
  { name: 'gunnery chase view, hud', query: 'warm=75&designate=1&trange=9&tbrg=-18&passive=1&tspd=0&scale=1' },
  { name: 'gunnery chase view, no hud', query: 'hud=0&warm=75&designate=1&trange=9&tbrg=-18&passive=1&tspd=0&scale=1' },
  { name: 'gunnery sight view, hud', query: 'sightup=1&warm=75&designate=1&trange=9&tbrg=-18&passive=1&tspd=0&scale=1' },
];
for (const cfg of GUNNERY) {
  test(`fps: ${cfg.name}`, async ({ page }) => {
    await page.goto(`/?sun=20&az=40&${cfg.query}`);
    await page.waitForFunction(() => (window.__frames ?? 0) >= 5, undefined, { timeout: 60_000 });
    const start = await page.evaluate(() => ({ frames: window.__frames ?? 0, t: performance.now() }));
    await page.waitForTimeout(4000);
    const end = await page.evaluate(() => ({ frames: window.__frames ?? 0, t: performance.now() }));
    const fps = ((end.frames - start.frames) * 1000) / (end.t - start.t);
    console.log(`${cfg.name}: ${fps.toFixed(1)} fps (${(1000 / fps).toFixed(1)} ms/frame)`);
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  });
}
