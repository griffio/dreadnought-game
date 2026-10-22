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

test('Run to the South: the Queen Elizabeth, the Kaiser and two torpedo boats', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.goto('/?mission=run-to-the-south&scale=0.75');
  await waitForFrames(page, 20);
  const s = await page.evaluate(() => {
    const g = window.__game!;
    return {
      player: g.playerEntry.id,
      name: g.playerCombatant.name,
      enemies: g.enemies.map((e) => e.combatant.name),
      kind: g.kind,
      guns: g.playerCombatant.batteries.map((b) => b.setup.gun.label),
      tubes: g.playerCombatant.tubes?.tubes.length ?? 0,
      range: Math.hypot(g.enemies[0]!.combatant.x - g.playerCombatant.x, g.enemies[0]!.combatant.z - g.playerCombatant.z),
      escortRange: Math.hypot(g.enemies[1]!.combatant.x - g.playerCombatant.x, g.enemies[1]!.combatant.z - g.playerCombatant.z),
    };
  });
  expect(s.player).toBe('queen-elizabeth');
  expect(s.name).toBe('HMS Queen Elizabeth');
  expect(s.enemies).toEqual(['SMS Kaiser', 'SMS S 144', 'SMS S 144']);
  expect(s.guns[0]).toContain('15"');
  expect(s.tubes).toBe(4);
  expect(s.range).toBeGreaterThan(14000);
  expect(s.escortRange).toBeLessThan(s.range);
  // The chart is up for the torpedo boats, and the orders are posted.
  await expect(page.locator('.chartplot canvas')).toBeVisible();
  await expect(page.locator('.mline', { hasText: 'ORDERS' })).toBeVisible();
  await page.screenshot({ path: 'test-results/run-to-the-south.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('Denmark Strait: the King George V against the Bismarck, and the quadruple turrets can jam', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto('/?mission=denmark-strait&scale=0.75&tscale=10&auto=evade');
  await waitForFrames(page, 20);
  const s = await page.evaluate(() => {
    const g = window.__game!;
    const quad = g.playerEntry.spec.turrets.filter((t) => t.guns === 4).map((t) => t.id);
    return {
      player: g.playerEntry.id,
      foe: g.enemies[0]!.combatant.name,
      main: g.playerCombatant.cfg.batteries[0]!.turretIds,
      quad,
      jams: g.playerCombatant.cfg.jams?.turretIds ?? [],
      directorHeight: g.playerCombatant.cfg.directorHeight,
    };
  });
  expect(s.player).toBe('king-george-v');
  expect(s.foe).toBe('Bismarck');
  expect(s.main).toEqual(['A', 'B', 'Y']);
  expect(s.quad).toEqual(['A', 'Y']);
  expect(s.jams).toEqual(['A', 'Y']);
  expect(s.directorHeight).toBe(31);
  // Force a jam: the turret goes out of action, and the bridge is told.
  await page.evaluate(() => window.__game!.playerCombatant.damage.jamTurret('A', 60, 'has jammed in the loading cycle'));
  await waitForFrames(page, 60);
  const jammed = await page.evaluate(() => window.__game!.playerCombatant.damage.turrets.find((t) => t.id === 'A')!.state);
  expect(jammed).toBe('jammed');
  await expect(page.locator('.mline', { hasText: 'Turret A has jammed' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/denmark-strait.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test("Bismarck's Last Stand: the wounded Bismarck circles, and a disabled ship is a win", async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto('/?mission=last-stand&scale=0.75&tscale=8');
  await waitForFrames(page, 20);
  const s = await page.evaluate(() => {
    const g = window.__game!;
    const b = g.enemies[0]!.combatant;
    return {
      player: g.playerEntry.id,
      steering: b.damage.steeringFailed,
      jam: b.dynamics.rudderJam,
      lost: b.damage.turrets.filter((t) => t.state === 'destroyed').map((t) => t.id),
      canStrike: b.damage.canStrike,
    };
  });
  expect(s.player).toBe('rodney');
  expect(s.steering).toBe(true);
  expect(s.jam).toBeCloseTo(-0.35, 2);
  expect(s.lost.sort()).toEqual(['B', 'Y']);
  expect(s.canStrike).toBe(false);
  // She steams in a circle: after a minute her heading has come round.
  const h0 = await page.evaluate(() => window.__game!.enemies[0]!.combatant.dynamics.heading);
  await page.waitForFunction(() => window.__game!.simTime > 60, undefined, { timeout: 60_000 });
  const h1 = await page.evaluate(() => window.__game!.enemies[0]!.combatant.dynamics.heading);
  expect(Math.abs(h1 - h0)).toBeGreaterThan(0.1);
  // Cripple her: she is beaten though she floats, and the sortie is won as a disabled enemy.
  await page.evaluate(() => {
    const b = window.__game!.enemies[0]!.combatant;
    for (const t of b.damage.turrets) t.state = 'destroyed';
  });
  await page.waitForFunction(() => window.__game!.outcome !== null, undefined, { timeout: 90_000 });
  const o = await page.evaluate(() => window.__game!.outcome!);
  expect(o.result).toBe('victory');
  expect(o.disabled).toBe(true);
  expect(o.how).toContain('disabled');
  await expect(page.locator('.rprestige')).toContainText('PRESTIGE');
  await expect(page.locator('.result')).toContainText('helpless');
  await page.screenshot({ path: 'test-results/last-stand.png' });
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});
