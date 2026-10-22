import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

/** Wait for `count` more frames from now (waitForFrames is a total since the page began, so it can return at once). */
async function framesLater(page: Page, count: number): Promise<void> {
  const now = await page.evaluate(() => window.__frames ?? 0);
  await waitForFrames(page, now + count);
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

// The step now, noting in the timeline the simulated time each began (seconds of play, whatever the test's clock).
const timeline: string[] = [];
const step = async (page: Page) => {
  const { id, t } = await page.evaluate(() => ({ id: window.__tutorial!.step.id, t: window.__game!.simTime }));
  if (timeline[timeline.length - 1]?.split('@')[0] !== id) timeline.push(`${id}@${Math.round(t)}s`);
  return id;
};

test('gunnery school: the coach takes a real fight from the first click to the last card', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watch(page);
  await page.goto('/?practice=gunnery-school&scale=0.5&tscale=10&warm=0');
  await waitForFrames(page, 20);

  // The card is up with the welcome, the target is a passive Hessen, and nobody can win or lose.
  await expect(page.locator('.tutor')).toBeVisible();
  await expect(page.locator('.tutor .ttitle')).toContainText('WELCOME');
  const setup = await page.evaluate(() => {
    const g = window.__game!;
    return { foe: g.enemies[0]!.combatant.name, passive: g.enemies[0]!.plan !== null, range: Math.hypot(g.enemies[0]!.combatant.x, g.enemies[0]!.combatant.z) };
  });
  expect(setup.foe).toBe('SMS Hessen');
  expect(setup.passive).toBe(true);
  expect(setup.range).toBeGreaterThan(8000);
  expect(setup.range).toBeLessThan(10000);
  await page.screenshot({ path: 'test-results/tutorial-1-welcome.png' });

  await page.getByRole('button', { name: 'BEGIN' }).click();
  expect(await step(page)).toBe('designate');
  await expect(page.locator('.tutor .ttext')).toContainText('Click');
  expect(await page.evaluate(() => document.body.dataset.tutFocus)).toBe('target');

  // 1. Pick a target (Tab cycles to the only ship).
  await page.keyboard.press('Tab');
  await expect.poll(() => step(page), { timeout: 20_000 }).toBe('plot');
  await expect(page.locator('.tutor .ttitle')).toContainText('PLOT');
  expect(await page.evaluate(() => document.body.dataset.tutFocus)).toBe('plot');
  await page.screenshot({ path: 'test-results/tutorial-2-plot.png' });

  // 2. The plot settles by itself (time is running at ten times).
  await expect.poll(() => step(page), { timeout: 120_000 }).toBe('fire');

  // 3. Fire, 4. watch, 5. correct as the card says, 6. bracket.
  const fire = async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(150);
    await page.keyboard.up('Space');
  };
  await expect
    .poll(async () => {
      await fire();
      return step(page);
    }, { timeout: 90_000 })
    .not.toBe('fire');
  await expect.poll(() => step(page), { timeout: 90_000 }).toMatch(/^(correct|bracket)$/);
  await page.screenshot({ path: 'test-results/tutorial-3-correct.png' });
  const advice = await page.locator('.tutor .ttext').textContent();
  expect(advice).toMatch(/SHORT|OVER|straddle|hit/i);
  // Do what it says: E adds range and Q takes it off.
  if (await page.evaluate(() => window.__tutorial!.step.id === 'correct')) {
    await page.keyboard.press(/OVER/.test(advice ?? '') ? 'KeyQ' : 'KeyE');
    await expect.poll(() => step(page), { timeout: 20_000 }).toMatch(/^(bracket|auto)$/);
  }

  // Keep firing, correcting by what the card says, until she is bracketed.
  await expect
    .poll(async () => {
      await fire();
      const text = (await page.locator('.tutor .ttext').textContent()) ?? '';
      const id = await step(page);
      if (id === 'bracket') {
        const last = await page.evaluate(() => window.__game!.status().lastReport?.meanRange ?? 0);
        if (Math.abs(last) > 120) await page.keyboard.press(last < 0 ? 'KeyE' : 'KeyQ');
      }
      void text;
      return id;
    }, { timeout: 240_000, intervals: [2_500] })
    .not.toBe('bracket');

  // 7. Auto-spot. (A lucky player may have sunk her already: the coach then passes over the shooting that is left, so the steps
  // that follow are still reached in order, only the hits step is passed over.)
  expect(await step(page)).toBe('auto');
  expect(await page.evaluate(() => document.body.dataset.tutFocus)).toBe('auto');
  await page.keyboard.press('KeyT');
  await expect.poll(() => step(page), { timeout: 10_000 }).toMatch(/^(hits|sight)$/);
  await page.screenshot({ path: 'test-results/tutorial-4-hits.png' });

  // 8. Three hits, firing salvo after salvo with the gunnery officer spotting.
  await expect
    .poll(async () => {
      await fire();
      return step(page);
    }, { timeout: 280_000, intervals: [2_000] })
    .not.toBe('hits');

  // 9. The director's sight.
  expect(await step(page)).toBe('sight');
  await page.keyboard.down('KeyV');
  await expect.poll(() => step(page), { timeout: 10_000 }).toBe('ruler');
  await page.keyboard.up('KeyV');

  // 10. The ruler is read, and then the school is complete and remembered.
  await expect(page.locator('.tutor .ttitle')).toContainText('CHOOSE YOUR RANGE');
  await page.getByRole('button', { name: 'NEXT' }).click();
  await expect(page.locator('.tutor .ttitle')).toContainText('COMPLETE');
  expect(await page.evaluate(() => window.__campaign!.practiceDone('gunnery-school'))).toBe(true);
  await page.screenshot({ path: 'test-results/tutorial-5-complete.png' });
  await expect(page.getByRole('button', { name: 'FIRST SORTIE' })).toBeVisible();
  await page.getByRole('button', { name: 'KEEP FIRING' }).click();
  await expect(page.locator('.tutor')).toBeHidden();
  expect(await page.evaluate(() => document.body.dataset.tutFocus)).toBe('');

  console.log(`gunnery school timeline (simulated seconds): ${timeline.join(' ')}`);
  // Practice has no result: whatever happens to the Hessen, no outcome appears.
  expect(await page.evaluate(() => window.__game!.outcome)).toBeNull();
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('gunnery school: the front door offers it first to a new player, and marks it done', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.goto('/?scale=0.5');
  await waitForFrames(page, 10);
  await expect(page.locator('.mcard.practice')).toHaveCount(1);
  await expect(page.locator('.mcard.practice .mstate')).toHaveText('START HERE');
  await expect(page.locator('.mdetail .dhead')).toHaveText('GUNNERY SCHOOL');
  await expect(page.locator('.msail')).toHaveText('BEGIN');
  await expect(page.locator('.msail')).toBeEnabled();
  await expect(page.locator('.dfoe')).toContainText('does not fire back');
  await page.screenshot({ path: 'test-results/tutorial-menu.png' });
  // The school does not lock or unlock the sorties.
  await expect(page.locator('.mcard[data-locked="1"]')).toHaveCount(5);
  await Promise.all([page.waitForURL(/practice=gunnery-school/), page.locator('.msail').click()]);
  await waitForFrames(page, 10);
  expect(await page.evaluate(() => document.body.dataset.menu)).toBe('0');
  expect(await page.evaluate(() => document.body.dataset.tutorial)).toBe('1');
  // Finished: the menu then says DONE and suggests the first sortie.
  await page.evaluate(() => window.__campaign!.finishPractice('gunnery-school'));
  await page.goto('/?scale=0.5');
  await waitForFrames(page, 10);
  await expect(page.locator('.mcard.practice .mstate')).toHaveText('DONE');
  await expect(page.locator('.mdetail .dhead')).toHaveText('ADMIRALTY TRIALS');
  expect(problems).toEqual([]);
});

// The coach's card must not sit on the touch buttons, the gun card or the helm on any of the iPad sizes, whether it is a
// dialogue to read (the welcome) or an instruction beside the action.
for (const [width, height] of [
  [1024, 768],
  [1180, 820],
  [1366, 1024],
] as const) {
  test(`gunnery school on touch ${width}x${height}: the card sits clear of the controls`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    // Designated from the URL: a key press would hand the screen back to the keyboard and hide the touch controls.
    await page.goto('/?touch=1&practice=gunnery-school&scale=0.5&tscale=1&designate=1');
    await waitForFrames(page, 10);
    const rect = (sel: string) =>
      page.evaluate((s) => {
        const e = document.querySelector(s);
        if (!e || (e as HTMLElement).hidden || getComputedStyle(e).display === 'none') return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, sel);
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
    const others = ['.gcard', '.helm .lever', '.helm .wheel', '.gtouch .steppers', '.gtouch .gbtn.fire', '.gtouch .gbtn.sight', '.gtouch .gbtn.auto', '.gtouch .gbtn.next', '.gtouch .gbtn.cease', '.gtouch .gbtn.damage', '.gtouch .gbtn.plot', '.gtouch .gbtn.tubes'];
    const check = async (label: string) => {
      await expect(page.locator('.tutor')).toBeVisible();
      const card = (await rect('.tutor'))!;
      expect(card.w, label).toBeGreaterThan(200);
      // The touch controls are really there, or this test would say nothing.
      expect(await rect('.lever'), `${label}: the lever is showing`).not.toBeNull();
      for (const sel of others) {
        const r = await rect(sel);
        if (r) expect(overlaps(card, r), `${label}: .tutor overlaps ${sel}`).toBe(false);
      }
      expect(card.x, label).toBeGreaterThanOrEqual(0);
      expect(card.x + card.w, label).toBeLessThanOrEqual(width);
      expect(card.y + card.h, label).toBeLessThanOrEqual(height);
      return card;
    };
    await check('welcome');
    await page.screenshot({ path: `test-results/tutorial-touch-${width}-welcome.png` });
    await page.getByRole('button', { name: 'BEGIN' }).click();
    await framesLater(page, 10);
    expect(await page.evaluate(() => window.__tutorial!.step.id)).toBe('plot');
    // Touch words, not keyboard words.
    await expect(page.locator('.tutor .ttext')).not.toContainText('Click');
    await check('plot');
    await page.screenshot({ path: `test-results/tutorial-touch-${width}.png` });
    // The instruction at its longest: the correction advice with a deflection to apply too.
    await page.evaluate(() => {
      const t = window.__tutorial!;
      while (t.step.id !== 'correct') t.next();
    });
    await page.evaluate(() => {
      const g = window.__game!.gunnery as unknown as { lastReport: unknown };
      g.lastReport = { salvo: 9, shells: [], hits: 0, meanRange: -740, meanDeflection: 90, call: 'SHORT', text: 'SHORT 740, RIGHT 90' };
    });
    await framesLater(page, 10);
    expect(await page.evaluate(() => window.__tutorial!.step.id)).toBe('correct');
    await expect(page.locator('.tutor .ttext')).toContainText('RANGE +');
    await check('correct');
    await page.screenshot({ path: `test-results/tutorial-touch-${width}-correct.png` });
  });
}
