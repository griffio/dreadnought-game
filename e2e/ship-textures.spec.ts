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

type Shot = { toString(encoding: 'base64'): string };

/** Hits start fires, and the camera is close: clear the smoke in the air, wait a couple of frames, and take the picture. */
async function clearShot(page: Page, path?: string): Promise<Shot> {
  await page.evaluate(() => window.__sea!.fx.particles.clear());
  await framesLater(page, 2);
  if (path) await page.screenshot({ path });
  // Only the hull: the sea in the rest of the picture moves on its own.
  return page.screenshot({ clip: { x: 0, y: 330, width: 1280, height: 190 } });
}

/** The Queen Elizabeth lying stopped, and a camera 28 m off her starboard side looking at her hull. */
const CLOSE = '/?scenario=duel&player=queen-elizabeth&target=0&free=1&scale=0.75&fov=40&hud=0&x=34&cam=6&z=-18&yaw=270&pitch=-3&sun=25&az=250';

test('ship textures: the atlases are served at their sizes, and the ships draw with them without error', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.goto(`${CLOSE}&weather=0.55`);
  await waitForFrames(page, 10);
  const sizes = await page.evaluate(async () => {
    const load = async (url: string) => {
      const r = await fetch(url);
      const bmp = await createImageBitmap(await r.blob());
      return { ok: r.ok, w: bmp.width, h: bmp.height };
    };
    return { weathering: await load('/textures/weathering.png'), decals: await load('/textures/decals.png') };
  });
  // Six layers of 512 and three of 256, one above the next.
  expect(sizes.weathering).toEqual({ ok: true, w: 512, h: 512 * 6 });
  expect(sizes.decals).toEqual({ ok: true, w: 256, h: 256 * 3 });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('ship textures: weathering visibly changes a hull, and a ship drawn with none is the plain one', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  const hull = async (weather: number) => {
    await page.goto(`${CLOSE}&weather=${weather}`);
    await waitForFrames(page, 10);
    await framesLater(page, 6);
    await page.screenshot({ path: `test-results/hull-weather-${weather}.png` });
    // Only the hull: the rest of the picture is sky and sea, which move on their own.
    return page.screenshot({ clip: { x: 0, y: 330, width: 1280, height: 190 } });
  };
  const clean = await hull(0);
  const worn = await hull(1);
  const worn2 = await hull(1);
  // The rust, grime and detail the pictures lay on a worn hull change the picture; the same hull twice is the same picture.
  expect(await meanDifference(page, clean, worn)).toBeGreaterThan(3);
  expect(await meanDifference(page, worn, worn2)).toBeLessThan(1);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('ship damage: a hit through the damage model leaves its mark on the hull; a mark from the future is not shown yet', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto(`${CLOSE}&weather=0.3`);
  await waitForFrames(page, 10);
  await framesLater(page, 6);
  const before = await clearShot(page, 'test-results/hull-before.png');
  // Three shells at her starboard side, the ship's heading being north: two burst inside, one breaks up on the belt.
  const result = await page.evaluate(() => {
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
    return { kinds: [fire(-26, 3.2, 700, 2), fire(-19, 2.4, 700, 2), fire(-9, 2.6, 300, 30)], count: g.player.instance.decals.count };
  });
  expect(result.kinds).toEqual(['burst', 'burst', 'shatter']);
  // Two bursts make a hole and a scorch each, the shattered shell a soft scorch.
  expect(result.count).toBe(5);
  await framesLater(page, 8);
  const marked = await clearShot(page, 'test-results/hull-marked.png');
  expect(await meanDifference(page, before, marked)).toBeGreaterThan(3);

  // The same marks dated in the future (as they are for a replay of an earlier moment) are not drawn.
  await page.evaluate(() => {
    for (const d of window.__game!.player.instance.decals.items) d.created += 1000;
  });
  await framesLater(page, 8);
  const hidden = await clearShot(page, 'test-results/hull-hidden.png');
  // (The sea moves between shots, so even an unchanged hull differs by about 1.5: the margins are set around that.)
  const hiddenDiff = await meanDifference(page, before, hidden);
  expect(hiddenDiff).toBeLessThan(2.3);
  // Brought back, they are there again; a hundred seconds on, the glow has gone and the scorch remains.
  await page.evaluate(() => {
    for (const d of window.__game!.player.instance.decals.items) d.created -= 1100;
  });
  await framesLater(page, 8);
  const cooled = await clearShot(page, 'test-results/hull-marked-cooled.png');
  const cooledDiff = await meanDifference(page, before, cooled);
  expect(cooledDiff).toBeGreaterThan(2.4);
  expect(cooledDiff).toBeGreaterThan(hiddenDiff + 0.8);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('ship damage: in a real fight both ships collect marks where they are hit', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto('/?playtest=arcade-duel&auto=closing&tscale=6&gseed=21&scale=0.5');
  await waitForFrames(page, 10);
  await page.waitForFunction(() => window.__game!.enemies[0]!.combatant.hitsTaken >= 2 || window.__game!.outcome !== null, undefined, { timeout: 200_000 });
  const marks = await page.evaluate(() => ({
    foeHits: window.__game!.enemies[0]!.combatant.hitsTaken,
    foeMarks: window.__game!.enemies[0]!.instance.decals.count,
    ownHits: window.__game!.playerCombatant.hitsTaken,
    ownMarks: window.__game!.player.instance.decals.count,
  }));
  expect(marks.foeHits).toBeGreaterThanOrEqual(2);
  // Every hit that struck her hull or works left at least one mark.
  expect(marks.foeMarks).toBeGreaterThanOrEqual(1);
  if (marks.ownHits >= 2) expect(marks.ownMarks).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});
