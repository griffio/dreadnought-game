import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

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

type Clip = { x: number; y: number; width: number; height: number };
type Shot = { toString(encoding: 'base64'): string };

/** Mean absolute difference per colour channel (0-255) between two PNGs of the same size. */
async function meanDifference(page: Page, a: Shot, b: Shot): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const pixels = async (s: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [pa, pb] = [await pixels(x!), await pixels(y!)];
      let sum = 0;
      for (let i = 0; i < pa.length; i += 4) sum += Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!);
      return sum / (pa.length / 4) / 3;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

/** Rodney's bow, from 60 m off her starboard side at the height of her deck. */
// The sea is pinned (freeze) so that the two pictures compared, taken on separate page loads, show her lying the same way.
const STARBOARD = '/?scenario=duel&player=rodney&target=0&free=1&freeze=20&scale=0.75&fov=45&hud=0&x=60&cam=9&z=-70&yaw=270&pitch=-4&sun=30&az=250&tele=0';
/** And from her port side. */
const PORT = '/?scenario=duel&player=rodney&target=0&free=1&freeze=20&scale=0.75&fov=45&hud=0&x=-60&cam=9&z=-70&yaw=90&pitch=-4&sun=25&az=250&tele=0';

async function crop(page: Page, url: string, clip: Clip, path?: string): Promise<Shot> {
  await page.goto(url);
  await waitForFrames(page, 10);
  await framesLater(page, 8);
  if (path) await page.screenshot({ path });
  return page.screenshot({ clip });
}

test('markings: a ship wears her hull number on both sides of the bow and the letters of her turrets', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  // The "29" on the starboard side, and the turret letters above it.
  const number = { x: 600, y: 360, width: 140, height: 80 };
  const turrets = { x: 200, y: 190, width: 940, height: 130 };
  const worn = await crop(page, STARBOARD, number, 'test-results/markings-starboard.png');
  const wornTurrets = await page.screenshot({ clip: turrets });
  const bare = await crop(page, `${STARBOARD}&marks=0`, number);
  const bareTurrets = await page.screenshot({ clip: turrets });
  // White paint on dark grey: a good deal of the number's crop changes (a mean of about 4). The letters are small grey-on-grey on the
  // shaded side, about 0.4 over the wide band of the turrets. With the sea pinned, two loads of the same ship are the same picture, so
  // these numbers are the markings alone (unpinned, the sparkle of the sea between loads used to add to them).
  expect(await meanDifference(page, worn, bare)).toBeGreaterThan(3);
  expect(await meanDifference(page, wornTurrets, bareTurrets)).toBeGreaterThan(0.2);
  await crop(page, STARBOARD, number);
  const wornTurretsAgain = await page.screenshot({ clip: turrets });
  expect(await meanDifference(page, wornTurrets, wornTurretsAgain)).toBeLessThan(0.05);

  // The port side has it too (the number is read the right way round from each side).
  const portNumber = { x: 520, y: 340, width: 200, height: 110 };
  const portWorn = await crop(page, PORT, portNumber, 'test-results/markings-port.png');
  const portBare = await crop(page, `${PORT}&marks=0`, portNumber);
  expect(await meanDifference(page, portWorn, portBare)).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('markings: every ship flies her navy’s ensign from the staff and the gaff, and hauls it down when she strikes', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto(STARBOARD);
  await waitForFrames(page, 10);
  const info = await page.evaluate(() => {
    const p = window.__player!;
    return { ensign: p.instance.paint.markings?.ensign, flags: p.model.flags.length, down: p.instance.rig.coloursDown };
  });
  expect(info).toEqual({ ensign: 'white', flags: 2, down: false });
  await page.evaluate(() => {
    (window.__game!.playerCombatant.damage as unknown as { status: string }).status = 'struck';
  });
  await framesLater(page, 4);
  expect(await page.evaluate(() => window.__player!.instance.rig.coloursDown)).toBe(true);
  // The picture still draws without error.
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);

  // A German ship flies a German flag.
  await page.goto('/?scenario=duel&player=hessen&target=0&free=1&scale=0.5&hud=0');
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => window.__player!.instance.paint.markings?.ensign)).toBe('imperial');
});

test('markings: dazzle paint breaks up the ship’s colours', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  const hull = { x: 0, y: 300, width: 1280, height: 120 };
  const plain = await crop(page, STARBOARD, hull);
  const dazzled = await crop(page, `${STARBOARD}&dazzle=7`, hull, 'test-results/markings-dazzle.png');
  const other = await crop(page, `${STARBOARD}&dazzle=3`, hull);
  // Bold black and white patches: a great change from plain grey, and a different pattern for a different seed.
  expect(await meanDifference(page, plain, dazzled)).toBeGreaterThan(15);
  expect(await meanDifference(page, dazzled, other)).toBeGreaterThan(8);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

/** A campaign in the player's browser: prestige in hand, and the sorties won so far. */
function campaign(won: string[], refits: Record<string, number> = {}, prestige = 50): string {
  const missions: Record<string, unknown> = {};
  for (const id of won) missions[id] = { wins: 1, attempts: 1, best: 10 };
  return JSON.stringify({ version: 1, prestige, missions, refits, unlockAll: false, practice: { trials: true }, pace: 'real' });
}

test('markings: the dockyard offers dazzle paint from 1916, once, and the fitted ship is painted and ranged badly by the enemy', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  const KEY = 'fall-of-shot.campaign';
  // Before "The Narrows" has been won, Run to the South is not open and the dockyard will not paint her.
  await page.goto('/?menu=1');
  await page.evaluate(([key, value]) => window.localStorage.setItem(key!, value!), [KEY, campaign(['trials', 'torpedo-boats'])] as const);
  await page.reload();
  await page.locator('.mtab', { hasText: 'DRY DOCK' }).click();
  const row = page.locator('.drefit[data-id="dazzle"]');
  await expect(row).toBeVisible();
  await expect(row.locator('.dbuy')).toBeDisabled();
  await expect(row).toContainText('Run to the South');

  // With it open, she can be fitted: the price is paid and it shows.
  await page.evaluate(([key, value]) => window.localStorage.setItem(key!, value!), [KEY, campaign(['trials', 'torpedo-boats', 'narrows'])] as const);
  await page.reload();
  await page.locator('.mtab', { hasText: 'DRY DOCK' }).click();
  await expect(row.locator('.dbuy')).toBeEnabled();
  await row.locator('.dbuy').click();
  await expect(row).toContainText('Fully fitted');
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('fall-of-shot.campaign')!).refits.dazzle)).toBe(1);

  // Into the sortie: she is painted in dazzle and the enemy's gunnery knows it.
  await page.goto('/?mission=run-to-the-south&gseed=3&scale=0.5');
  await waitForFrames(page, 10);
  const fitted = await page.evaluate(() => ({
    seed: window.__player!.instance.paint.markings?.dazzle,
    setup: window.__game!.playerSetup.dazzle,
    contact: window.__game!.playerCombatant.dazzle,
  }));
  expect(fitted.seed).toBeGreaterThan(0);
  expect(fitted.setup).toBe(1);
  expect(fitted.contact).toBe(1);

  // Without the refit she is not.
  await page.evaluate(([key, value]) => window.localStorage.setItem(key!, value!), [KEY, campaign(['trials', 'torpedo-boats', 'narrows'])] as const);
  await page.goto('/?mission=run-to-the-south&gseed=3&scale=0.5');
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => window.__player!.instance.paint.markings?.dazzle ?? 0)).toBe(0);
  expect(await page.evaluate(() => window.__game!.playerCombatant.dazzle)).toBe(0);
  expect(problems.filter((p) => !/favicon/i.test(p))).toEqual([]);
});
