import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DUEL = '/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=8&tcrs=0&tele=3&gseed=3&scale=0.5';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

const stats = (page: Page) => page.evaluate(() => window.__audio!.stats());
const voicesHeard = async (page: Page, prefix = 'voice-') => Object.entries((await stats(page)).byId).filter(([id]) => id.startsWith(prefix)).reduce((n, [, c]) => n + c, 0);

/** The page is up, every sound (the crew's lines too) is decoded, and a key has been pressed so that the browser lets them play. */
async function ready(page: Page): Promise<void> {
  await page.goto(DUEL);
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__voice?.() !== null && window.__voice?.() !== undefined, undefined, { timeout: 30_000 });
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await stats(page)).state, { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => { const s = await stats(page); return s.loaded === s.total && s.total >= 100; }, { timeout: 40_000 }).toBe(true);
}

test('voices: a call from the crew is spoken in the crew’s voice, once, and not again at once', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  await ready(page);

  // The fight has begun and the lookout may already have spoken: count from here.
  const before = await voicesHeard(page);
  await page.waitForTimeout(500);
  const accepted = await page.evaluate(() => window.__voice!()!.cue('turret-out'));
  const spokenNow = accepted ? 1 : 0;
  await expect.poll(() => voicesHeard(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(before + spokenNow);
  if (accepted) expect(Object.keys((await stats(page)).byId).some((id) => id.startsWith('voice-turret-out'))).toBe(true);
  // The same call again is within its cooldown: nothing is said.
  const after = await voicesHeard(page);
  expect(await page.evaluate(() => window.__voice!()!.cue('turret-out'))).toBe(false);
  await page.waitForTimeout(300);
  expect(await voicesHeard(page)).toBe(after);
  expect(problems.filter((p) => !/favicon/i.test(p))).toEqual([]);
});

test('voices: a hit on the player’s ship is called by damage control and put in the log', async ({ page }) => {
  test.setTimeout(150_000);
  await ready(page);
  // Let the opening calls (the lookout sighting the enemy) be over, so the call is not held back by someone speaking.
  await page.waitForTimeout(9_000);
  const before = await voicesHeard(page, 'voice-hit-taken');
  await page.evaluate(() => {
    const g = window.__game!;
    const shell = g.playerSetup.batteries[0]!.gun.shell;
    const fire = (z: number, y: number, speed: number, descent: number) => {
      const a = (descent * Math.PI) / 180;
      const vx = -Math.cos(a) * speed;
      const vy = -Math.sin(a) * speed;
      const dt = 1 / 60;
      const live = { id: 1, salvo: 1, shooter: 99, spec: shell, state: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 }, passed: [] };
      return g.playerCombatant.resolveHit({ shell: live, from: [12.5 - vx * dt, y - vy * dt, z], to: [12.5, y, z], velocity: [vx, vy, 0] } as never)?.kind;
    };
    fire(-26, 3.2, 700, 2);
    fire(-19, 2.4, 700, 2);
  });
  await expect.poll(() => voicesHeard(page, 'voice-hit-taken'), { timeout: 15_000 }).toBeGreaterThan(before);
  const log = await page.evaluate(() => window.__game!.messages.all().map((m) => m.text));
  expect(log.some((t) => /^DAMAGE CONTROL: ".+"$/.test(t))).toBe(true);
});

test('voices: the player can turn the crew off and keep the rest of the sound', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await page.waitForTimeout(9_000);
  await page.evaluate(() => window.__audio!.setVoices(false));
  const before = await voicesHeard(page);
  const effects = (await stats(page)).played;
  await page.evaluate(() => window.__voice!()!.cue('sinking'));
  await page.evaluate(() => window.__player!.fire());
  await page.waitForTimeout(1_500);
  expect(await voicesHeard(page)).toBe(before);
  // The guns are still heard.
  expect((await stats(page)).played).toBeGreaterThan(effects);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fall-of-shot.audio')!).voices)).toBe(false);
});
