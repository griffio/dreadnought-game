import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

/** Wait for this many more frames than have been rendered so far (waitForFrames counts from page load). */
async function framesLater(page: Page, count: number): Promise<void> {
  const now = await page.evaluate(() => window.__frames ?? 0);
  await waitForFrames(page, now + count);
}

/** A screenshot, as far as these checks care: something that can be written out as base64. */
type Shot = { toString(encoding: 'base64'): string };

/** Mean absolute difference per colour channel (0-255) between two PNGs of the same size. */
async function meanDifference(page: Page, a: Shot, b: Shot): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const pixels = async (b64: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [pa, pb] = [await pixels(x!), await pixels(y!)];
      let sum = 0;
      let n = 0;
      for (let i = 0; i < pa.length; i += 4) {
        sum += Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!);
        n += 3;
      }
      return sum / n;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

// The sight's camera sits in the foretop, among the legs of the mast. The mast must not fill the view: with the ship drawn or not,
// the director sees the same sea, because there is nothing of her within a few metres of the lens to be seen.
for (const ship of ['queen-elizabeth', 'dreadnought', 'king-george-v', 'rodney'] as const) {
  test(`director's sight (${ship}): the ship's own mast does not fill the view`, async ({ page }) => {
    test.setTimeout(120_000);
    let heel = 0;
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(String(e)));
    // Stationary, the target a passive ship, no interface in the way: nothing in the frame but the sea and sky (and the ship, if she shows).
    // The ship is in a hard turn at full speed: she heels, and the mast leans across the place where the lens is.
    await page.goto(`/?scenario=duel&player=${ship}&foe=kaiser&trange=9&tbrg=-25&passive=1&tspd=0&tele=4&rud=1&tscale=5&sightup=1&designate=1&hud=0&scale=0.5&pace=arcade`);
    await waitForFrames(page, 10);
    await page.waitForFunction(() => window.__game!.simTime >= 25, undefined, { timeout: 90_000 });
    await framesLater(page, 10);
    expect(await page.evaluate(() => window.__sight!.owns)).toBe(true);
    heel = await page.evaluate(() => Math.abs(window.__player!.instance.pose.roll));
    expect(heel, 'she is heeling over in the turn').toBeGreaterThan(0.02);
    const withShip = await page.screenshot({ path: `test-results/sight-with-ship-${ship}.png` });
    await page.evaluate(() => {
      window.__player!.instance.visible = false;
    });
    await framesLater(page, 4);
    const withoutShip = await page.screenshot();
    await page.screenshot({ path: `test-results/sight-clear-${ship}.png` });
    console.log(`${ship}: roll ${((heel * 180) / Math.PI).toFixed(1)} deg`);
    // The sea moves a little between two frames of a ship under way (about 2.5 to 3 grey levels on average); a mast leg in the lens
    // moves it by 8 to 30.
    expect(await meanDifference(page, withShip, withoutShip)).toBeLessThan(4.5);
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('director’s sight: the cutaway is on only while the sight is up, so the chase camera still sees the whole ship', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=0&tele=0&hud=0&scale=0.5');
  await waitForFrames(page, 10);
  await framesLater(page, 10);
  expect(await page.evaluate(() => window.__player!.instance.cutaway)).toBe(0);
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=0&tele=0&hud=0&scale=0.5&sightup=1&designate=1');
  await waitForFrames(page, 10);
  await framesLater(page, 10);
  expect(await page.evaluate(() => window.__player!.instance.cutaway)).toBeGreaterThan(5);
});
