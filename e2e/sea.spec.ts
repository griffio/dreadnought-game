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

// The sea's grid is drawn only in the arc the camera can see: the picture must be the one the whole circle gives, exactly, from a level
// view and from the shell camera's steep one.
for (const [name, query] of [
  ['level', 'sun=12&az=90&yaw=0&pitch=-4&clouds=0.2&wind=14&cam=6'],
  ['steep', 'sun=30&az=200&yaw=140&pitch=-62&clouds=0.3&wind=16&cam=40&fov=70'],
] as const) {
  test(`the sea culled to the view is the whole circle's picture (${name})`, async ({ page }) => {
    const shot = async (extra: string) => {
      await page.goto(`/?hud=0&freeze=40&scale=0.5&ship=0&${query}${extra}`);
      await waitForFrames(page, 6);
      const arc = await page.evaluate(() => window.__sea!.oceanArc);
      return { png: (await page.screenshot()).toString('base64'), arc };
    };
    const culled = await shot('');
    const whole = await shot('&oceancull=0');
    expect(whole.arc.count).toBe(384);
    if (name === 'level') expect(culled.arc.count).toBeLessThan(384 * 0.6);
    const diff = await page.evaluate(
      async ([a, b]) => {
        const pixels = async (b64: string) => {
          const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          const g = c.getContext('2d')!;
          g.drawImage(bmp, 0, 0);
          return g.getImageData(0, 0, bmp.width, bmp.height).data;
        };
        const [pa, pb] = [await pixels(a), await pixels(b)];
        let differing = 0;
        for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!) > 6) differing++;
        return differing / (pa.length / 4);
      },
      [culled.png, whole.png] as const,
    );
    // The sea is frozen and the sky is the same: nothing but float rounding may differ.
    expect(diff).toBeLessThan(0.001);
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  });
}
