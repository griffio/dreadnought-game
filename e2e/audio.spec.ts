import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DUEL = '/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=7&passive=1&tspd=8&tcrs=0&tele=3&gseed=3&scale=0.5';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

const stats = (page: Page) => page.evaluate(() => window.__audio!.stats());

/** The page is up, the sounds are fetched, and a key has been pressed so that the browser lets them play. */
async function ready(page: Page): Promise<void> {
  await page.goto(DUEL);
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__director?.() !== null, undefined, { timeout: 30_000 });
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await stats(page)).state, { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => (await stats(page)).loaded, { timeout: 30_000 }).toBeGreaterThan(40);
}

test('sound: nothing plays until the page is touched, then every sound is decoded and the beds start', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));

  await page.goto(DUEL);
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__director?.() !== null, undefined, { timeout: 30_000 });
  expect((await stats(page)).state).toBe('none');

  await page.keyboard.press('Shift');
  await expect.poll(async () => (await stats(page)).state, { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => { const s = await stats(page); return s.loaded === s.total && s.total >= 40; }, { timeout: 30_000 }).toBe(true);
  // The sea and the engines come in under the ship.
  await expect.poll(async () => (await stats(page)).loops, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(problems.filter((p) => !/favicon/i.test(p))).toEqual([]);
});

test('sound: a broadside is heard as heavy guns, and a shell’s fall as a splash', async ({ page }) => {
  test.setTimeout(150_000);
  await ready(page);
  const before = await stats(page);
  await page.evaluate(() => window.__player!.fire());
  await expect.poll(async () => Object.keys((await stats(page)).byId).some((id) => id.startsWith('gun-heavy')), { timeout: 15_000 }).toBe(true);
  expect((await stats(page)).played).toBeGreaterThan(before.played);
  // A salvo of a dozen guns is not a dozen sounds.
  const guns = Object.entries((await stats(page)).byId).filter(([id]) => id.startsWith('gun-heavy')).reduce((n, [, c]) => n + c, 0);
  expect(guns).toBeLessThanOrEqual(6);
  // Its shells come down in the sea, a few kilometres off: the splashes are heard.
  await page.evaluate(() => { /* let the shells fly at the game's own pace */ });
  await expect.poll(async () => Object.keys((await stats(page)).byId).some((id) => id.startsWith('splash') || id.startsWith('hit-')), { timeout: 90_000 }).toBe(true);
});

test('sound: N turns the sound off and on, and the choice is kept', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  expect(await page.evaluate(() => window.__audio!.muted)).toBe(false);
  await page.keyboard.press('KeyN');
  expect(await page.evaluate(() => window.__audio!.muted)).toBe(true);
  const played = (await stats(page)).played;
  await page.evaluate(() => window.__player!.fire());
  await page.waitForTimeout(1500);
  expect((await stats(page)).played).toBe(played);

  // Reloaded, it is still off.
  await page.reload();
  await waitForFrames(page, 5);
  expect(await page.evaluate(() => window.__audio!.muted)).toBe(true);
  await page.keyboard.press('KeyN');
  expect(await page.evaluate(() => window.__audio!.muted)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fall-of-shot.audio')!).muted)).toBe(false);
});

test('sound: the touch SOUND button mutes and says so', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${DUEL}&touch=1`);
  await waitForFrames(page, 10);
  const button = page.locator('.gtouch .soundbtn');
  await expect(button).toBeVisible();
  await expect(button).toContainText('SOUND');
  await button.dispatchEvent('pointerdown');
  await expect(button).toContainText('SOUND OFF');
  expect(await page.evaluate(() => window.__audio!.muted)).toBe(true);
  await button.dispatchEvent('pointerdown');
  await expect(button).not.toContainText('OFF');
  expect(await page.evaluate(() => window.__audio!.muted)).toBe(false);
});
