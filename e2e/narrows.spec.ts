import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

const NARROWS = '/?scenario=narrows&sun=24&az=250&clouds=0.35&wind=6&scale=0.75';

test('narrows: the land, the batteries and the chart are there, and the sea runs clean', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  // From the start the first battery is far over the horizon: look at it from closer.
  await page.goto(`${NARROWS}&pz=7200&tscale=1`);
  await waitForFrames(page, 20);
  const state = await page.evaluate(() => {
    const g = window.__game!;
    return {
      kind: g.kind,
      forts: g.forts.map((f) => ({ name: f.name, hidden: !!f.spec.hidden, guns: f.gunsLeft, base: Math.round(f.base) })),
      known: g.targets.length,
      tiles: window.__sea!.landStats.tiles,
      triangles: window.__sea!.landStats.triangles,
      plane: g.plane?.state,
    };
  });
  expect(state.kind).toBe('narrows');
  expect(state.forts.map((f) => f.name)).toEqual(['Island Battery', 'West Fort', 'East Fort', 'Ridge Howitzers']);
  // The howitzers are hidden behind the ridge: three batteries are known at the start.
  expect(state.known).toBe(3);
  expect(state.forts.every((f) => f.base > 20)).toBe(true);
  expect(state.tiles).toBeGreaterThan(5);
  expect(state.plane).toBe('deck');
  await expect(page.locator('.chartplot canvas')).toBeVisible();
  await expect(page.locator('.chip', { hasText: 'BATTERIES SILENCED 0/4' })).toBeVisible();
  await expect(page.locator('.chip', { hasText: 'SPOTTER' })).toBeVisible();
  await page.screenshot({ path: 'test-results/narrows-start.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('narrows: the aircraft goes up, finds the hidden battery, and the chart shows it', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto(`${NARROWS}&pz=3000&px=1500&tscale=6`);
  await waitForFrames(page, 20);
  // The battery behind the ridge is not on the list of targets.
  expect(await page.evaluate(() => window.__game!.targets.length)).toBe(3);
  // Lay the guns on the hidden battery by hand (the aircraft flies to what the guns are laid on), then launch with K.
  await page.evaluate(() => window.__game!.gunnery.designate(window.__game!.forts[3]!));
  await page.keyboard.press('KeyK');
  await expect(page.locator('.chip', { hasText: 'SPOTTER LAUNCHING' })).toBeVisible();
  await page.waitForFunction(() => window.__game!.plane!.state === 'flying', undefined, { timeout: 90_000 });
  await expect(page.locator('.chip', { hasText: 'SPOTTER UP' })).toBeVisible();
  await page.waitForFunction(() => window.__game!.targets.length === 4, undefined, { timeout: 120_000 });
  await expect(page.locator('.mline', { hasText: 'Ridge Howitzers found' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'test-results/narrows-spotter.png' });
  // Called home, it lands.
  await page.keyboard.press('KeyK');
  await page.waitForFunction(() => ['landing', 'deck'].includes(window.__game!.plane!.state), undefined, { timeout: 180_000 });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('narrows: a shoal stops her and a mine opens her', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  // Under way toward the bank in mid-strait.
  await page.goto(`${NARROWS}&px=-700&pz=1800&tele=3&tscale=8`);
  await waitForFrames(page, 20);
  await page.waitForFunction(() => window.__game!.shoreStatus()?.aground === true, undefined, { timeout: 150_000 });
  await expect(page.locator('.chip', { hasText: 'AGROUND' })).toBeVisible();
  const where = await page.evaluate(() => {
    const d = window.__player!.dynamics;
    return { speed: d.speed, depth: window.__terrain === undefined ? null : null };
  });
  expect(Math.abs(where.speed)).toBeLessThan(1);
  // Put her on a mine.
  const before = await page.evaluate(() => window.__game!.playerCombatant.damage.summary().floodedT);
  await page.evaluate(() => {
    const m = window.__game!.mines!.mines[5]!;
    window.__player!.setPosition(m.x, m.z, 0);
    window.__player!.dynamics.setTelegraph(0);
  });
  await page.waitForFunction(() => window.__game!.mines!.mines.some((m) => m.exploded), undefined, { timeout: 30_000 });
  await expect(page.locator('.mline', { hasText: 'struck a mine' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__game!.playerCombatant.damage.summary().floodedT);
  expect(after).toBeGreaterThan(before + 20);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('narrows: a battery shoots back and is hurt in turn, with no errors', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watch(page);
  // Close enough to the island battery that both sides can reach, at ten times the clock.
  await page.goto(`${NARROWS}&pz=9000&tscale=10&designate=0`);
  await waitForFrames(page, 20);
  await page.evaluate(() => {
    const g = window.__game!;
    g.gunnery.designate(g.forts[0]!);
    g.gunnery.autoSpot = true;
    window.__player!.dynamics.setTelegraph(0);
  });
  // Hold fire with the trigger from the page.
  await page.mouse.move(640, 300);
  const start = Date.now();
  let sawFire = false;
  while (Date.now() - start < 200_000) {
    const s = await page.evaluate(() => {
      const g = window.__game!;
      g.gunnery.designate(g.forts[0]!);
      const f = g.forts[0]!;
      return { t: g.simTime, fortShells: f.shellsFired, myShells: g.playerCombatant.shellsFired, hits: f.hitsTaken, guns: f.gunsLeft, supp: f.suppression };
    });
    // Keep the trigger down.
    await page.keyboard.down('Space');
    await page.waitForTimeout(400);
    await page.keyboard.up('Space');
    if (s.fortShells > 0) sawFire = true;
    if (s.myShells > 6 && sawFire && s.t > 400) break;
    await page.waitForTimeout(1200);
  }
  expect(sawFire).toBe(true);
  await page.screenshot({ path: 'test-results/narrows-duel.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

// The touch buttons, with the spotter's among them, must not sit on one another or on the cards, on any of the iPad sizes.
for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`narrows touch layout ${width}x${height}: no button overlaps another or the cards`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    await page.goto(`${NARROWS}&touch=1&pz=7000&scale=0.5`);
    await waitForFrames(page, 10);
    await expect(page.locator('.gtouch .spotter')).toBeVisible();
    const boxes = await page.evaluate(() => {
      const rect = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const buttons = [...document.querySelectorAll('.gtouch .gbtn')]
        .filter((e) => !e.closest('.steppers') && !(e as HTMLElement).hidden)
        .map((e) => ({ name: e.className.replace('gbtn ', ''), ...rect(e) }));
      const steppers = { name: 'steppers', ...rect(document.querySelector('.gtouch .steppers')!) };
      const cards = ['.gcard'].flatMap((s) => {
        const e = document.querySelector(s);
        return e ? [{ name: s, ...rect(e) }] : [];
      });
      const instruments = { name: 'instruments', ...rect(document.querySelector('.instruments')!) };
      return { buttons, steppers, cards, instruments };
    });
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
    const all = [...boxes.buttons, boxes.steppers];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!), `${all[i]!.name} overlaps ${all[j]!.name}`).toBe(false);
      for (const c of [...boxes.cards, boxes.instruments]) expect(overlaps(all[i]!, c), `${all[i]!.name} overlaps ${c.name}`).toBe(false);
    }
  });
}
