import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

type PlayerState = { telegraph: number; speedKn: number; rudder: number; rudderOrder: number; headingDeg: number; x: number; z: number };

const state = (page: Page): Promise<PlayerState> =>
  page.evaluate(() => {
    const d = window.__player!.dynamics;
    return { telegraph: d.telegraph, speedKn: d.speedKnots, rudder: d.rudder, rudderOrder: d.rudderOrder, headingDeg: d.headingDeg, x: d.x, z: d.z };
  });

const waitForFrames = (page: Page, n: number) =>
  page.waitForFunction((count) => (window.__frames ?? 0) >= count, n, { timeout: 90_000 });

/** Wait for `n` more rendered frames: input is read once per frame, so this is the honest way to let it be seen. */
const nextFrames = async (page: Page, n: number): Promise<void> => {
  const now = await page.evaluate(() => window.__frames ?? 0);
  await waitForFrames(page, now + n);
};

/** Poll the ship's telegraph until it reads `want` (a stalled frame on a busy machine must not fail the test). */
const expectTelegraph = (page: Page, want: number) => expect.poll(async () => (await state(page)).telegraph, { timeout: 5000 }).toBe(want);

async function noErrors(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
}

test.describe('keyboard and mouse', () => {
  test('W/S step the telegraph, the ship builds way, A/D turn the wheel, X recentres', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto('/?scale=0.5&freeze=5');
    await waitForFrames(page, 3);
    await page.keyboard.press('KeyW');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('KeyW');
    await expectTelegraph(page, 3);

    await page.keyboard.press('KeyS');
    await expectTelegraph(page, 2);
    await page.keyboard.press('ArrowUp');
    await expectTelegraph(page, 3);

    // Hold D: the wheel order ramps toward hard starboard and the rudder follows at the steering-gear rate.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1600);
    await page.keyboard.up('KeyD');
    const turning = await state(page);
    expect(turning.rudderOrder).toBeGreaterThan(0.5);
    expect(turning.rudder).toBeGreaterThan(0.02);
    expect(turning.speedKn).toBeGreaterThan(0.05);

    await page.keyboard.press('KeyX');
    await page.waitForTimeout(200);
    expect((await state(page)).rudderOrder).toBe(0);
    expect(problems).toEqual([]);
    await noErrors(page);
  });

  test('the instruments show the ship state', async ({ page }) => {
    await page.goto('/?scale=0.5&tele=3&warm=60');
    await waitForFrames(page, 3);
    const text = await page.locator('.instruments').innerText();
    expect(text).toContain('FULL AHEAD');
    expect(text).toMatch(/\d+\.\d kn/);
    expect(text).toMatch(/\d{3}°/);
  });
});

test.describe('gamepad', () => {
  test('left stick flicks the telegraph and steers; the HUD switches to gamepad hints', async ({ page }) => {
    // A controllable fake pad behind navigator.getGamepads.
    await page.addInitScript(() => {
      const pad = {
        connected: true,
        id: 'fake standard pad',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      };
      (window as unknown as { __pad: typeof pad }).__pad = pad;
      navigator.getGamepads = () => [pad as unknown as Gamepad];
    });
    await page.goto('/?scale=0.5&freeze=5');
    await waitForFrames(page, 3);
    const setAxes = (x: number, y: number) =>
      page.evaluate(([ax, ay]) => {
        const pad = (window as unknown as { __pad: { axes: number[] } }).__pad;
        pad.axes[0] = ax!;
        pad.axes[1] = ay!;
      }, [x, y]);

    const flick = async (y: number) => {
      await setAxes(0, y);
      await nextFrames(page, 3);
      await setAxes(0, 0);
      await nextFrames(page, 3);
    };
    await flick(-1); // flick up
    await expectTelegraph(page, 1);
    await flick(-1);
    await expectTelegraph(page, 2);
    await flick(1); // flick down
    await expectTelegraph(page, 1);

    await setAxes(1, 0); // hard starboard
    await expect.poll(async () => (await state(page)).rudderOrder, { timeout: 5000 }).toBeGreaterThan(0.9);
    await setAxes(0, 0); // release: back to midships
    await expect.poll(async () => (await state(page)).rudderOrder, { timeout: 5000 }).toBe(0);

    await expect(page.locator('body')).toHaveAttribute('data-input', 'gamepad');
    await expect(page.locator('.hints')).toContainText('L-stick');
    await noErrors(page);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

  test('the lever and the wheel steer the ship with real touch events', async ({ page }) => {
    await page.goto('/?scale=0.5&freeze=5&touch=1');
    await waitForFrames(page, 3);
    await expect(page.locator('.helm .wheel')).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });

    // Lever: touch near the top of the track -> FLANK; near the middle -> a low setting.
    const track = (await page.locator('.helm .track').boundingBox())!;
    await touch('touchStart', track.x + 128, track.y + 2);
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(250);
    expect((await state(page)).telegraph).toBe(4);
    await touch('touchStart', track.x + 128, track.y + track.height * 0.6);
    await touch('touchMove', track.x + 128, track.y + track.height * 0.6 + 1);
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(250);
    const mid = (await state(page)).telegraph;
    expect(mid).toBeLessThan(4);
    expect(mid).toBeGreaterThan(-3);

    // Wheel: drag a quarter turn clockwise around its centre -> starboard rudder order.
    const wheel = (await page.locator('.helm .wheel').boundingBox())!;
    const cx = wheel.x + wheel.width / 2;
    const cy = wheel.y + wheel.height / 2;
    const r = wheel.width * 0.4;
    await touch('touchStart', cx, cy - r); // 12 o'clock
    for (let i = 1; i <= 9; i++) {
      const a = (i / 9) * (Math.PI / 2);
      await touch('touchMove', cx + Math.sin(a) * r, cy - Math.cos(a) * r); // sweep to 3 o'clock
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    const held = (await state(page)).rudderOrder;
    expect(held).toBeGreaterThan(0.2);
    expect(held).toBeLessThan(0.5);

    // Release: with auto-centre on, the wheel unwinds toward midships.
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(1800);
    expect((await state(page)).rudderOrder).toBeLessThan(held * 0.5);
    await expect(page.locator('body')).toHaveAttribute('data-input', 'touch');
    await noErrors(page);
  });
});
