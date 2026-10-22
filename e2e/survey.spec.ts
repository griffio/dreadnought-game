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
  expect(rows.length).toBe(18);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
});
