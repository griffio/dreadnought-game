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

const DUEL = '/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=6&tcrs=70&designate=1&tscale=3&scale=0.5';

/** The colours of the tracer specks in the air now: a glow of one frame's life, yellow (armour-piercing) or red (high-explosive). */
const tracerColours = (page: Page) =>
  page.evaluate(() => {
    const live = (window.__sea!.fx.particles as unknown as { live: { kind: number; life: number; r: number; g: number; b: number }[] }).live;
    const tracers = live.filter((p) => p.kind === 1 && p.life <= 0.03);
    return { n: tracers.length, red: tracers.filter((p) => p.r > 0.9 && p.g < 0.3).length, yellow: tracers.filter((p) => p.r > 0.9 && p.g > 0.8).length };
  });

test('shells: 1 and 2 choose armour-piercing and high-explosive, the card says which, and the tracers are coloured to match', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  await page.goto(DUEL);
  await waitForFrames(page, 10);
  const shell = () => page.evaluate(() => window.__game!.gunnery.shell);
  expect(await shell()).toBe('ap');
  await expect(page.locator('.gshell')).toContainText('AP');
  await expect(page.locator('.gshell')).toHaveAttribute('data-kind', 'ap');
  // The penetration ruler belongs to armour-piercing.
  await expect(page.locator('.gruler')).toBeVisible();

  await page.keyboard.press('Digit2');
  await expect.poll(shell).toBe('he');
  await expect(page.locator('.gshell')).toContainText('HE');
  await expect(page.locator('.gshell')).toHaveAttribute('data-kind', 'he');
  await expect(page.locator('.gruler')).toBeHidden();
  expect(await page.evaluate(() => window.__game!.messages.all().some((m) => m.text.startsWith('HIGH-EXPLOSIVE loaded')))).toBe(true);
  await page.screenshot({ path: 'test-results/shell-he-card.png' });

  // A high-explosive salvo leaves red tracers; after the change back, the next is yellow.
  await page.waitForFunction(() => window.__game!.gunnery.status !== undefined && window.__game!.status().quality === 'settled', undefined, { timeout: 120_000 });
  await page.evaluate(() => window.__player!.fire());
  await expect.poll(async () => (await tracerColours(page)).red, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0);
  expect((await tracerColours(page)).yellow).toBe(0);
  await page.screenshot({ path: 'test-results/shell-he-tracers.png' });

  await page.keyboard.press('Digit1');
  await expect.poll(shell).toBe('ap');
  await expect(page.locator('.gshell')).toHaveAttribute('data-kind', 'ap');
  await expect(page.locator('.gruler')).toBeVisible();
  // Wait for the first salvo to be down and the guns to reload (22 s), then fire again.
  await page.waitForFunction(() => window.__game!.gunnery.world.shells.length === 0 && window.__game!.status().turrets.every((t) => t.loaded >= 1), undefined, { timeout: 120_000 });
  await page.evaluate(() => window.__player!.fire());
  await expect.poll(async () => (await tracerColours(page)).yellow, { timeout: 90_000, intervals: [100] }).toBeGreaterThan(0);
  expect((await tracerColours(page)).red).toBe(0);
  await page.screenshot({ path: 'test-results/shell-ap-tracers.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('shells: the choice is for the main guns: the anti-destroyer guns keep their own round', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scenario=destroyers&dd=1&scale=0.5');
  await waitForFrames(page, 10);
  // The Dreadnought's main guns do have the choice; it is her twelve-pounders that do not, and they are not the main battery.
  expect(await page.evaluate(() => window.__game!.gunnery.shellChoice)).toBe(true);
  await page.keyboard.press('Digit2');
  await expect.poll(() => page.evaluate(() => window.__game!.gunnery.shell)).toBe('he');
  // The self-directing twelve-pounders still fire their own impact-fuzed shell.
  expect(await page.evaluate(() => window.__game!.playerCombatant.batteries.filter((b) => b.setup.id !== 'main').every((b) => b.gunnery.shell === 'ap'))).toBe(true);
});

for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`shells, touch ${width}x${height}: the SHELL button names the round, changes it, and sits clear of the other buttons and the cards`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height });
    await page.goto(`${DUEL}&touch=1`);
    await waitForFrames(page, 10);
    const btn = page.locator('.gtouch .shell');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('SHELL AP');
    await expect(btn).toHaveAttribute('data-kind', 'ap');
    await btn.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    await expect.poll(() => page.evaluate(() => window.__game!.gunnery.shell)).toBe('he');
    await expect(btn).toContainText('SHELL HE');
    await expect(btn).toHaveAttribute('data-kind', 'he');
    await page.screenshot({ path: `test-results/shell-touch-${width}.png` });
    await btn.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true });
    await expect.poll(() => page.evaluate(() => window.__game!.gunnery.shell)).toBe('ap');

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
    expect(all.some((b) => b.name === 'shell')).toBe(true);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!), `${all[i]!.name} overlaps ${all[j]!.name}`).toBe(false);
      for (const c of [...boxes.cards, boxes.instruments]) expect(overlaps(all[i]!, c), `${all[i]!.name} overlaps ${c.name}`).toBe(false);
    }
  });
}
