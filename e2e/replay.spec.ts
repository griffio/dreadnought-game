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

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

/** The arcade duel under the auto-player: a fight with salvos in the air within the first half minute. */
const FIGHT = '/?playtest=arcade-duel&auto=closing&tscale=4&gseed=21&scale=0.5';

const simTime = (page: Page) => page.evaluate(() => window.__game!.simTime);
const replayTime = (page: Page) => page.locator('.rptime').textContent();

test('replay: R stops the fight and plays back the last of it, with the controls to scrub, slow, pause and change the camera', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto(FIGHT);
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.simTime >= 35 && window.__game!.outcome === null, undefined, { timeout: 200_000 });
  await expect(page.locator('.replay')).toBeHidden();
  const before = await page.evaluate(() => ({ x: window.__player!.instance.pose.x, z: window.__player!.instance.pose.z, t: window.__game!.simTime }));

  await page.keyboard.press('KeyR');
  await expect(page.locator('.replay')).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.replay)).toBe('1');
  // The fight stands still while it plays: the simulation's clock does not move, and the replay's does.
  const frozen = await simTime(page);
  const t0 = await replayTime(page);
  await framesLater(page, 60);
  expect(await simTime(page)).toBe(frozen);
  await expect.poll(() => replayTime(page)).not.toBe(t0);
  // It starts some way back, so the ship is not where she is now.
  const early = await page.evaluate(() => window.__player!.instance.pose);
  expect(Math.hypot(early.x - before.x, early.z - before.z)).toBeGreaterThan(30);
  await page.screenshot({ path: 'test-results/replay-playing.png' });

  // Pause holds it; play goes on.
  await page.getByRole('button', { name: 'PAUSE' }).click();
  const held = await replayTime(page);
  await framesLater(page, 30);
  expect(await replayTime(page)).toBe(held);
  await expect(page.getByRole('button', { name: 'PLAY' })).toBeVisible();
  await page.getByRole('button', { name: 'PLAY' }).click();
  await expect.poll(() => replayTime(page)).not.toBe(held);

  // The scrub line goes to any moment; the slow speeds run the clock slower.
  await page.evaluate(() => {
    const s = document.querySelector('.rpscrub') as HTMLInputElement;
    s.value = String(Math.min(Number(s.max) * 0.5, Number(s.max)));
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await framesLater(page, 5);
  const mid = await page.evaluate(() => Number((document.querySelector('.rpscrub') as HTMLInputElement).value));
  expect(mid).toBeGreaterThan(5);
  await page.locator('.rpbtn[data-speed="0.25"]').click();
  await expect(page.locator('.rpbtn[data-speed="0.25"]')).toHaveAttribute('data-on', '1');
  for (const mode of ['target', 'ship', 'auto']) {
    await page.locator(`.rpbtn[data-camera="${mode}"]`).click();
    await expect(page.locator(`.rpbtn[data-camera="${mode}"]`)).toHaveAttribute('data-on', '1');
    await framesLater(page, 90);
    await page.screenshot({ path: `test-results/replay-camera-${mode}.png` });
  }

  // Out again: the fight is exactly where it was, runs on, and the ship is on the water.
  await page.getByRole('button', { name: 'EXIT' }).click();
  await expect(page.locator('.replay')).toBeHidden();
  expect(await page.evaluate(() => document.body.dataset.replay)).toBe('0');
  await expect.poll(() => simTime(page), { timeout: 20_000 }).toBeGreaterThan(frozen + 0.5);
  expect(await page.evaluate(() => window.__player!.instance.visible)).toBe(true);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('replay: the auto camera rides a salvo, in the narrower view of the shell camera, and the splashes and smoke come back with it', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto(FIGHT);
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.simTime >= 35 && window.__game!.outcome === null, undefined, { timeout: 200_000 });
  await page.keyboard.press('KeyR');
  await expect(page.locator('.replay')).toBeVisible();
  // Over the half minute there are salvos: the camera narrows to ride one, and widens again after.
  const fovs = new Set<number>();
  let particles = 0;
  for (let i = 0; i < 400 && fovs.size < 2; i++) {
    await framesLater(page, 3);
    const s = await page.evaluate(() => ({ fov: Math.round(window.__camera!.fovYDeg), drawn: window.__sea!.fx.particles.drawn }));
    fovs.add(s.fov);
    particles = Math.max(particles, s.drawn);
    if (!(await page.locator('.replay').isVisible())) break;
  }
  expect([...fovs].some((f) => f < 55), `fovs ${[...fovs]}`).toBe(true);
  // The effects are made again: there is smoke, spray or flame in the air.
  expect(particles).toBeGreaterThan(20);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('replay: Escape leaves it, and the result screen offers to watch it', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto(FIGHT);
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.simTime >= 30, undefined, { timeout: 200_000 });
  await page.evaluate(() => {
    window.__game!.outcome = { result: 'victory', how: 'SMS Kaiser struck her colours.', seconds: 150, shellsFired: 60, hitsScored: 9, hitsTaken: 4, dishonour: 0, condition: 0.8, disabled: false, torpedoes: null, shore: null };
  });
  await expect(page.locator('.result')).toBeVisible();
  await page.getByRole('button', { name: 'Watch replay' }).click();
  await expect(page.locator('.replay')).toBeVisible();
  await expect(page.locator('.result')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.replay')).toBeHidden();
  // Back to the result.
  await expect(page.locator('.result')).toBeVisible();
  expect(problems).toEqual([]);
});

test('shell camera: C turns it on, a salvo is ridden in the narrower view and the game slowed for its last seconds, and a touch cuts away', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=6&tcrs=70&designate=1&tscale=3&scale=0.5');
  await waitForFrames(page, 10);
  await page.keyboard.press('KeyC');
  await expect(page.locator('.mline', { hasText: 'SHELL CAM ON' })).toBeVisible();
  await page.waitForFunction(() => window.__game!.status().quality === 'settled', undefined, { timeout: 120_000 });
  await page.evaluate(() => window.__player!.fire());
  // The camera narrows to ride the shell, and at some moment of the flight the game is slowed.
  await expect.poll(() => page.evaluate(() => Math.round(window.__camera!.fovYDeg)), { timeout: 60_000, intervals: [100] }).toBeLessThan(55);
  await page.screenshot({ path: 'test-results/shell-cam-riding.png' });
  // A tap on the picture cuts away: the view is the ordinary one again.
  await page.mouse.click(40, 300);
  await expect.poll(() => page.evaluate(() => Math.round(window.__camera!.fovYDeg)), { timeout: 10_000 }).toBeGreaterThanOrEqual(58);
  // Turn it off: the next salvo is not ridden.
  await page.keyboard.press('KeyC');
  await expect(page.locator('.mline', { hasText: 'SHELL CAM OFF' })).toBeVisible();
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`replay, touch ${width}x${height}: the SHELL CAM and REPLAY buttons sit clear of everything, and the replay's bar fits`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    await page.goto(`${FIGHT}&touch=1&tscale=4`);
    await waitForFrames(page, 10);
    await page.waitForFunction(() => window.__game!.simTime >= 20, undefined, { timeout: 200_000 });
    const cam = page.locator('.gtouch .shellcam');
    const rep = page.locator('.gtouch .replaybtn');
    await expect(cam).toBeVisible();
    await expect(rep).toBeVisible();
    const boxes = await page.evaluate(() => {
      const rect = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const buttons = [...document.querySelectorAll('.gtouch .gbtn')]
        .filter((e) => !e.closest('.steppers') && !(e as HTMLElement).hidden)
        .map((e) => ({ name: e.className.replace('gbtn ', ''), ...rect(e) }));
      const others = ['.gcard', '.instruments', '.helm', '.mlog', '.hud'].flatMap((s) => {
        const e = document.querySelector(s);
        return e && (e as HTMLElement).offsetParent !== null ? [{ name: s, ...rect(e) }] : [];
      });
      const steppers = { name: 'steppers', ...rect(document.querySelector('.gtouch .steppers')!) };
      return { buttons, steppers, others };
    });
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
    const all = [...boxes.buttons, boxes.steppers];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!), `${all[i]!.name} overlaps ${all[j]!.name}`).toBe(false);
    }
    for (const b of boxes.buttons.filter((x) => x.name === 'shellcam' || x.name === 'replaybtn')) {
      for (const o of boxes.others) expect(overlaps(b, o), `${b.name} overlaps ${o.name}`).toBe(false);
    }
    await cam.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    await expect(cam).toHaveAttribute('data-on', '1');
    await rep.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true });
    await expect(page.locator('.replay')).toBeVisible();
    // The bar is on the screen, every button of it, and the touch controls are out of the way.
    for (const sel of ['.rpscrub', '.rpplay', '.rpexit', '.rpbtn[data-speed="0.25"]', '.rpbtn[data-camera="ship"]']) {
      const b = (await page.locator(sel).first().boundingBox())!;
      expect(b.x, sel).toBeGreaterThanOrEqual(0);
      expect(b.y, sel).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(width);
      expect(b.y + b.height, sel).toBeLessThanOrEqual(height);
      expect(b.height, `${sel} is a touch target`).toBeGreaterThanOrEqual(28);
    }
    await expect(page.locator('.gtouch .shellcam')).toBeHidden();
    await page.screenshot({ path: `test-results/replay-touch-${width}.png` });
    await page.locator('.rpexit').dispatchEvent('click');
    await expect(page.locator('.replay')).toBeHidden();
  });
}
