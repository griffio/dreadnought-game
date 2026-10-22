import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 90_000 });
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

const SCENE = 'sun=22&az=40&clouds=0.35&wind=9&freeze=40&scale=1';

test('gunnery: the target card, brackets and turret pips appear for a designated target', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/?warm=75&designate=1&trange=9&tbrg=-18&passive=1&tspd=0&${SCENE}`);
  await waitForFrames(page, 12);
  await expect(page.locator('.gcard .gname')).toHaveText('SMS HESSEN');
  await expect(page.locator('.gcard .gquality')).toContainText(/SETTL|PLOTT/);
  await expect(page.locator('.gpipbox')).toHaveCount(5);
  await expect(page.locator('.gbracket[data-designated="1"]')).toBeVisible();
  const range = await page.locator('.gcard .gcell output').first().textContent();
  expect(range).toMatch(/^[\d,]+ m$/);
  await page.screenshot({ path: 'test-results/gunnery-card.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('gunnery: the director\'s sight shows the target close up', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/?warm=75&designate=1&trange=9&tbrg=28&passive=1&tspd=0&sightup=1&${SCENE}`);
  await waitForFrames(page, 40);
  await expect(page.locator('.greticle')).toBeVisible();
  await page.screenshot({ path: 'test-results/gunnery-sight.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('gunnery: a salvo fires, its shells fly, and the splashes are called', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  // Plot and slew for 70 s of simulated time, then hold the trigger.
  await page.goto(`/?warm=72&warmfire=70&designate=1&autospot=1&trange=9&tbrg=28&passive=1&tspd=0&sightup=1&${SCENE}`);
  await waitForFrames(page, 10);
  await page.screenshot({ path: 'test-results/gunnery-muzzle.png' });
  const fired = await page.evaluate(() => window.__game!.gunnery.world.shells.length);
  expect(fired).toBeGreaterThan(0);
  // Real time: the shells take about fifteen seconds to arrive.
  await page.waitForFunction(() => window.__game!.status().lastReport !== null, undefined, { timeout: 60_000 });
  await page.screenshot({ path: 'test-results/gunnery-splash.png' });
  const report = await page.evaluate(() => window.__game!.status().lastReport!.text);
  expect(report).toMatch(/HIT|STRADDLE|SHORT|OVER/);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('gunnery: a broadside seen from the quarter', async ({ page }) => {
  const problems = watch(page);
  // The target is on the port beam, so A, P, X and Y all bear. The camera sits off the port side.
  await page.goto(`/?warm=72&warmfire=70&designate=1&trange=6&tbrg=-85&passive=1&tspd=0&orbit=240,9,260&${SCENE}`);
  await waitForFrames(page, 6);
  await page.screenshot({ path: 'test-results/gunnery-broadside.png' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/gunnery-broadside-later.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('gunnery input: click to designate, keys to correct and fire, right button for the sight', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/?warm=2&trange=6&tbrg=-18&passive=1&tspd=0&${SCENE}`);
  await waitForFrames(page, 8);
  await expect(page.locator('.gcard .gname')).toContainText('NO TARGET');

  // Click the ship's bracket.
  const box = (await page.locator('.gbracket').first().boundingBox())!;
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.gcard .gname')).toHaveText('SMS HESSEN');

  // Clicking empty sea lets go of the target.
  await page.mouse.click(120, 400);
  await expect(page.locator('.gcard .gname')).toContainText('NO TARGET');
  await page.keyboard.press('Tab');
  await expect(page.locator('.gcard .gname')).toHaveText('SMS HESSEN');

  // Corrections and auto-spot.
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('BracketLeft');
  await expect(page.locator('.gcorr')).toContainText('RANGE +200');
  await expect(page.locator('.gcorr')).toContainText('DEFL L10');
  await page.keyboard.press('KeyT');
  await expect(page.locator('.gcorr')).toContainText('AUTO-SPOT ON');
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.gcorr')).toContainText('RANGE +100');

  // Space arms a salvo; B stands the guns down.
  await page.keyboard.press('Space');
  await expect(page.locator('.gsalvo')).toContainText('ARMED');
  await page.keyboard.press('KeyB');
  await expect(page.locator('.gsalvo')).not.toContainText('ARMED');

  // The right mouse button holds the sight up.
  await expect(page.locator('.greticle')).toBeHidden();
  await page.mouse.move(640, 300);
  await page.mouse.down({ button: 'right' });
  await expect(page.locator('.greticle')).toBeVisible();
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.greticle')).toBeHidden({ timeout: 5000 });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test.describe('gunnery touch', () => {
  test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

  test('tap a ship, tap the steppers, hold FIRE, raise the sight', async ({ page }) => {
    const problems = watch(page);
    await page.goto(`/?warm=2&trange=6&tbrg=-18&passive=1&tspd=0&touch=1&${SCENE}`);
    await waitForFrames(page, 8);
    await expect(page.locator('body')).toHaveAttribute('data-input', 'touch');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const centre = async (selector: string) => {
      const b = (await page.locator(selector).first().boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const tap = async (selector: string) => {
      const c = await centre(selector);
      await touch('touchStart', c.x, c.y);
      await page.waitForTimeout(40);
      await touch('touchEnd', 0, 0);
      await page.waitForTimeout(60);
    };

    // Tap the ship's bracket to designate it.
    await tap('.gbracket');
    await expect(page.locator('.gcard .gname')).toHaveText('SMS HESSEN');

    // The steppers apply spotting corrections.
    await tap('.gtouch .steppers .gbtn:nth-child(1)'); // RANGE +
    await tap('.gtouch .steppers .gbtn:nth-child(1)');
    await tap('.gtouch .steppers .gbtn:nth-child(4)'); // DEFL R
    await expect(page.locator('.gcorr')).toContainText('RANGE +200');
    await expect(page.locator('.gcorr')).toContainText('DEFL R10');
    await tap('.gtouch .auto');
    await expect(page.locator('.gcorr')).toContainText('AUTO-SPOT ON');

    // A tap on FIRE arms a salvo even though the finger is gone before the guns are ready; CEASE stands down.
    await tap('.gtouch .fire');
    await expect(page.locator('.gsalvo')).toContainText('ARMED');
    await tap('.gtouch .cease');
    await expect(page.locator('.gsalvo')).not.toContainText('ARMED');

    // SIGHT toggles the director's sight up and down.
    await tap('.gtouch .sight');
    await expect(page.locator('.greticle')).toBeVisible();
    await tap('.gtouch .sight');
    await expect(page.locator('.greticle')).toBeHidden({ timeout: 5000 });

    // The sight remembers how it was aimed: pan it with a finger, put it down, raise it again, and it is still there.
    await tap('.gtouch .sight');
    await expect(page.locator('.greticle')).toBeVisible();
    const drag = async (dx: number) => {
      const x0 = 520;
      const y0 = 300;
      await touch('touchStart', x0, y0);
      for (let i = 1; i <= 8; i++) await touch('touchMove', x0 + (dx * i) / 8, y0);
      await touch('touchEnd', 0, 0);
      await page.waitForTimeout(120);
    };
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({ yaw: window.__sight!.yawDeg, pitch: window.__sight!.pitchDeg }));
    await drag(260);
    const panned = await page.evaluate(() => ({ yaw: window.__sight!.yawDeg, pitch: window.__sight!.pitchDeg, fov: window.__sight!.fovDeg }));
    // The drag really moved the view (otherwise this proves nothing).
    expect(Math.abs(panned.yaw - before.yaw)).toBeGreaterThan(0.5);
    await tap('.gtouch .sight');
    await expect(page.locator('.greticle')).toBeHidden({ timeout: 5000 });
    await tap('.gtouch .sight');
    await expect(page.locator('.greticle')).toBeVisible();
    await page.waitForTimeout(400);
    const again = await page.evaluate(() => ({ yaw: window.__sight!.yawDeg, pitch: window.__sight!.pitchDeg, fov: window.__sight!.fovDeg }));
    expect(Math.abs(again.yaw - panned.yaw)).toBeLessThan(0.2);
    expect(Math.abs(again.pitch - panned.pitch)).toBeLessThan(0.2);
    expect(Math.abs(again.fov - panned.fov)).toBeLessThan(0.5);
    await tap('.gtouch .sight');
    await expect(page.locator('.greticle')).toBeHidden({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/gunnery-touch.png' });
    expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test('gunnery: with no target the guns follow the sight', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/?target=0&sightup=1&warm=2&hdg=40&${SCENE}`);
  await waitForFrames(page, 20);
  const ordered = await page.evaluate(() => {
    const t = window.__game!.gunnery.battery.turrets.find((x) => x.mount.id === 'A')!;
    return { train: (t.orderedTrain * 180) / Math.PI, elev: (t.orderedElev * 180) / Math.PI, bears: t.bears };
  });
  // The sight starts looking along the ship's heading, just above the horizon: dead ahead, at full elevation.
  expect(ordered.bears).toBe(true);
  expect(Math.abs(ordered.train)).toBeLessThan(2);
  expect(ordered.elev).toBeGreaterThan(12);
  await expect(page.locator('.gcard .gname')).toContainText('NO TARGET');
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});
