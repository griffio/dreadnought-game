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

// A whole torpedo attack in the browser, with the player's ship under a captain who turns toward every wake he sees.
test('torpedo attack: the destroyers run in, the wakes are seen and warned of, and the fight is decided', async ({ page }) => {
  test.setTimeout(480_000);
  const problems = watch(page);
  await page.goto('/?scenario=destroyers&dd=2&auto=evade&tscale=8&trange=7&gseed=3&sun=24&az=300&clouds=0.4&wind=6&scale=0.75');
  await waitForFrames(page, 10);
  await expect(page.locator('.chartplot canvas')).toBeVisible();
  // The chart table is drawn: rings, our own ship, and more than an empty disc.
  const inked = await page.evaluate(() => {
    const c = document.querySelector('.chartplot canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) n++;
    return n;
  });
  expect(inked).toBeGreaterThan(5000);

  const seen = new Set<string>();
  const shoot = async (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    await page.screenshot({ path: `test-results/torpedo-${name}.png` });
  };
  const start = Date.now();
  type Result = { result: string; how: string; torpedoes: { fired: number; hits: number } | null };
  let outcome: Result | null = null as Result | null;
  let sawChip = false;
  let maxParticles = 0;
  while (Date.now() - start < 440_000) {
    const s = await page.evaluate(() => {
      const g = window.__game!;
      return {
        outcome: g.outcome,
        torpedoes: g.arena.torpedoes.torpedoes.length,
        seen: g.threats().length,
        smoke: g.arena.smoke.clouds.length,
        status: g.enemies.map((e) => e.combatant.damage.status),
        particles: window.__sea!.fx.particles.active,
        t: g.simTime,
      };
    });
    maxParticles = Math.max(maxParticles, s.particles);
    if (s.torpedoes > 0 && s.seen === 0) await shoot('wakes-unseen');
    if (s.seen > 0) {
      await shoot('wake-seen');
      sawChip ||= (await page.locator('.chip', { hasText: 'TORPEDO' }).count()) > 0;
    }
    if (s.smoke > 20) await shoot('smoke');
    if (s.outcome) {
      outcome = s.outcome as Result;
      await page.waitForTimeout(600);
      await shoot('result');
      break;
    }
    await page.waitForTimeout(1200);
  }
  expect(outcome).not.toBeNull();
  expect(sawChip).toBe(true);
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.rstats')).toContainText('Torpedoes fired at you');
  expect(outcome!.torpedoes!.fired).toBeGreaterThan(0);
  expect(maxParticles).toBeGreaterThan(50);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

// The player's own tubes: the card, the lead marker, turning to bring them to bear, and a launch that runs.
test('torpedo mode: the card shows the solution, the tubes bear, and the fan is launched', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  // A target steaming north on the starboard beam: led a little forward of the beam, inside the starboard tubes' arc.
  await page.goto('/?passive=1&tcrs=0&tspd=6&trange=2.4&tbrg=90&thdg=0&designate=1&warm=3&sun=26&az=290&clouds=0.4&wind=6&scale=0.75&freeze=40&tscale=2&orbit=-100,12,140');
  await waitForFrames(page, 8);
  await expect(page.locator('.tcard')).toBeHidden();

  await page.keyboard.press('KeyF');
  await expect(page.locator('.tcard')).toBeVisible();
  await expect(page.locator('.gcard')).toBeHidden();
  await expect(page.locator('.tname')).toHaveText('TORPEDOES');
  await expect(page.locator('.ttarget')).toContainText('SMS HESSEN');
  // The plot needs a minute to settle before the lead can be trusted.
  await page.waitForFunction(() => window.__game!.torpedoStatus()?.solution !== null, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.tmark i')).toBeVisible();
  await page.screenshot({ path: 'test-results/torpedo-mode.png' });

  // Whatever the solution says about bearing, fire when it says LAUNCH: wait for the plot to put a tube on the bearing.
  await page.waitForFunction(() => (window.__game!.torpedoStatus()?.solution?.bearing ?? 0) > 0, undefined, { timeout: 60_000 });
  await expect(page.locator('.tline')).toContainText('LAUNCH');
  const before = await page.evaluate(() => window.__game!.arena.torpedoes.launched);
  await page.keyboard.press('Space');
  await page.waitForFunction((n) => window.__game!.arena.torpedoes.launched > n, before, { timeout: 15_000 });
  await expect(page.locator('.mline', { hasText: 'Torpedoes running' })).toBeVisible();
  // Her guns held their fire: the trigger was for the torpedoes.
  expect(await page.evaluate(() => window.__game!.playerCombatant.shellsFired)).toBe(0);
  // The tubes that fired are empty and reloading.
  await expect(page.locator('.ttube[data-state="reload"]').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/torpedo-launched.png' });

  // F puts the guns back in hand.
  await page.keyboard.press('KeyF');
  await expect(page.locator('.tcard')).toBeHidden();
  await expect(page.locator('.gcard')).toBeVisible();
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

// An iPad in landscape: the tubes button, the launch ring, and a plot that stays clear of the telegraph.
test('torpedo mode on touch: the buttons relabel, and the plot does not sit on the telegraph', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/?touch=1&scenario=destroyers&dd=2&trange=6&tscale=1&warm=2&sun=26&az=290&clouds=0.4&wind=6&scale=0.75');
  await waitForFrames(page, 8);
  await expect(page.locator('.gtouch .tubes')).toBeVisible();
  await expect(page.locator('.gtouch .plot')).toBeVisible();
  await expect(page.locator('.chartplot')).toBeVisible();

  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const plot = await box('.chartplot');
  const lever = await box('.helm .lever');
  const overlap = plot.x < lever.x + lever.width && plot.x + plot.width > lever.x && plot.y < lever.y + lever.height && plot.y + plot.height > lever.y;
  expect(overlap).toBe(false);

  await page.locator('.gtouch .tubes').dispatchEvent('pointerdown');
  await expect(page.locator('.tcard')).toBeVisible();
  // Nothing was designated: taking up the tubes picked the nearest destroyer.
  await expect(page.locator('.ttarget')).toContainText('SMS S 144');
  await expect(page.locator('.gtouch .fire span')).toHaveText('LAUNCH');
  await expect(page.locator('.gtouch .auto span')).toHaveText('RUN SPEED');
  await expect(page.locator('.gtouch .steppers .gbtn span').nth(3)).toHaveText('FAN +');
  await page.screenshot({ path: 'test-results/torpedo-touch.png' });
  // The plot button hides and shows the chart.
  await page.locator('.gtouch .plot').dispatchEvent('pointerdown');
  await expect(page.locator('.chartplot')).toBeHidden();
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

// The touch buttons must not sit on one another or on the gun and torpedo cards, on any of the iPad sizes.
for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`touch layout ${width}x${height}: no button overlaps another button or the cards`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await page.goto('/?touch=1&scenario=destroyers&dd=2&trange=6&tscale=1&designate=1&warm=2&scale=0.5');
    await waitForFrames(page, 8);
    const boxes = async () =>
      page.evaluate(() => {
        const rect = (e: Element) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const buttons = [...document.querySelectorAll('.gtouch .gbtn')]
          .filter((e) => !e.closest('.steppers'))
          .map((e) => ({ name: e.className.replace('gbtn ', ''), ...rect(e) }));
        const steppers = rect(document.querySelector('.gtouch .steppers')!);
        const cards = ['.gcard', '.tcard'].flatMap((s) => {
          const e = document.querySelector(s);
          return e && !(e as HTMLElement).hidden && getComputedStyle(e).display !== 'none' ? [{ name: s, ...rect(e) }] : [];
        });
        return { buttons, steppers: { name: 'steppers', ...steppers }, cards };
      });
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
    for (const mode of ['guns', 'tubes']) {
      if (mode === 'tubes') await page.locator('.gtouch .tubes').dispatchEvent('pointerdown');
      await page.waitForTimeout(300);
      const { buttons, steppers, cards } = await boxes();
      expect(cards.length).toBeGreaterThan(0);
      const all = [...buttons, steppers];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!), `${mode}: ${all[i]!.name} overlaps ${all[j]!.name}`).toBe(false);
        for (const c of cards) expect(overlaps(all[i]!, c), `${mode}: ${all[i]!.name} overlaps ${c.name}`).toBe(false);
      }
    }
    await page.screenshot({ path: `test-results/torpedo-touch-${width}.png` });
  });
}
