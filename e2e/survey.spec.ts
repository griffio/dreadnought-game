import { expect, test } from './fixtures';

// Runs the in-page performance survey (the same one the iPad button runs) and prints the table.
test('perf survey runs and every step reports sensible numbers', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?hud=0&shot=0&free=1&sun=20&az=40&clouds=0.5&survey=1');
  await page.waitForFunction(() => (window.__survey?.length ?? 0) > 0, undefined, { timeout: 200_000 });
  const rows = await page.evaluate(() => window.__survey!);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(34)} cost ${r.costMs.toFixed(1).padStart(5)} ms${r.clipped ? '*' : ' '} (${r.deltaMs >= 0 ? '+' : ''}${r.deltaMs.toFixed(1)})  cpu ${r.cpuMs.toFixed(1)} ms  x${r.repeats}  ${(r.pixels / 1e6).toFixed(2)} MP`,
    );
    expect(r.fps).toBeGreaterThan(0.5);
    expect(r.costMs).toBeGreaterThan(0);
  }
  expect(rows.length).toBe(32);
  // The new scenes are in it: the ship hurt, broken in two, and the wreckage.
  for (const name of ['ship drawn with the discarding shader', 'ship finish: and no reflections or haze', 'ship hurt: fires, wrecks, dazzle', 'ship broken in two', 'wreckage and oil slick', 'ship under the sight cutaway', 'baseline (after the ship scenes)']) expect(rows.map((r) => r.name)).toContain(name);
  // And the dev server has had the report to keep.
  await expect.poll(() => page.evaluate(() => window.__perfSent ?? ''), { timeout: 10_000 }).toMatch(/^perf-results\/survey-.*-macintosh\.json$/);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
});

// The short survey of the ship alone, which is what the iPad is asked to run for the ship's cost.
test('the ship survey runs only the ship steps, in order, and sends its report', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=6&hud=0&survey=ship');
  await page.waitForFunction(() => (window.__survey?.length ?? 0) > 0, undefined, { timeout: 280_000 });
  const rows = await page.evaluate(() => window.__survey!);
  expect(rows.map((r) => r.name)).toEqual([
    'baseline',
    'ship drawn with the discarding shader',
    'ship finish: no damage looks or lettering',
    'ship finish: and no weathering pictures',
    'ship finish: and no noise or plating',
    'ship finish: and no shadow lookups',
    'ship finish: and no reflections or haze',
    'baseline (after the ship ladder)',
    'ship hurt: fires, wrecks, dazzle',
    'ship broken in two',
    'ship broken in two: hull and decks only',
    'ship broken in two: works only',
    'wreckage and oil slick',
    'ship under the sight cutaway',
    'baseline (after the ship scenes)',
    'no sun shadow',
    'no ship (and no shadow)',
  ]);
  for (const r of rows) expect(r.costMs).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__perfSent ?? ''), { timeout: 10_000 }).toMatch(/^perf-results\/survey-/);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
});
