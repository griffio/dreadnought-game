import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__frames ?? 0) >= n, count, { timeout: 120_000 });
}

async function framesLater(page: Page, count: number): Promise<void> {
  const now = await page.evaluate(() => window.__frames ?? 0);
  await waitForFrames(page, now + count);
}

async function simSeconds(page: Page, seconds: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__game!.simTime);
  await page.waitForFunction((t) => window.__game!.simTime >= t, t0 + seconds, { timeout: 120_000 });
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

type Instances = { ships: { visible: boolean; section: unknown; split: { side: number } }[] };
const instances = (page: Page) =>
  page.evaluate(() => {
    const r = (window.__sea as unknown as { ships: Instances }).ships;
    return r.ships.map((s) => ({ visible: s.visible, section: s.section !== null, side: s.split.side }));
  });

/** The Queen Elizabeth lying stopped, seen from 150 m off her starboard side, looking toward her. */
const SIDE = '/?scenario=duel&player=queen-elizabeth&target=0&free=1&scale=0.5&fov=50&hud=0&x=150&cam=35&z=20&yaw=285&pitch=-14&sun=30&az=250&tele=0&tscale=4';
/** Close to her forward turrets. */
const TURRET = '/?scenario=duel&player=queen-elizabeth&target=0&free=1&scale=0.75&fov=40&hud=0&x=48&cam=14&z=-50&yaw=270&pitch=-12&sun=25&az=250';

test('damage: a turret the damage model wrecks is wrecked in the picture, charred and out of use', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.goto(TURRET);
  await waitForFrames(page, 10);
  await framesLater(page, 4);
  expect(await page.evaluate(() => window.__player!.instance.rig.isWrecked('B'))).toBe(false);
  await page.evaluate(() => window.__sea!.fx.particles.clear());
  const before = await page.screenshot({ clip: { x: 400, y: 100, width: 600, height: 260 } });
  await page.evaluate(() => {
    const t = window.__game!.playerCombatant.damage.turrets.find((x) => x.id === 'B')!;
    t.state = 'destroyed';
  });
  await framesLater(page, 6);
  expect(await page.evaluate(() => window.__player!.instance.rig.isWrecked('B'))).toBe(true);
  // The turret is wrecked and burnt; it no longer follows the guns.
  expect(await page.evaluate(() => window.__player!.instance.rig.char.some((c) => c > 0.8))).toBe(true);
  await page.evaluate(() => window.__sea!.fx.particles.clear());
  await framesLater(page, 2);
  const after = await page.screenshot({ clip: { x: 400, y: 100, width: 600, height: 260 }, path: 'test-results/turret-wrecked.png' });
  const diff = await page.evaluate(
    async ([a, b]) => {
      const pixels = async (s: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [pa, pb] = [await pixels(a!), await pixels(b!)];
      let sum = 0;
      for (let i = 0; i < pa.length; i += 4) sum += Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!);
      return sum / (pa.length / 4) / 3;
    },
    [before.toString('base64'), after.toString('base64')] as const,
  );
  expect(diff).toBeGreaterThan(1.5);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('damage: a magazine going up breaks the ship in two, and the halves go down', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto(SIDE);
  await waitForFrames(page, 10);
  const whole = await instances(page);
  expect(whole.filter((s) => s.side !== 0)).toHaveLength(0);

  await page.evaluate(() => {
    const d = window.__game!.playerCombatant.damage as unknown as { status: string; sinkTime: number; explosionX: number };
    d.explosionX = 18;
    d.status = 'exploded';
    d.sinkTime = 0;
  });
  await simSeconds(page, 2);
  await framesLater(page, 3);
  const broken = await instances(page);
  // One more instance, the stern; each shows its own part of the ship and is moved about the break.
  expect(broken).toHaveLength(whole.length + 1);
  const sides = broken.map((s) => s.side).filter((s) => s !== 0).sort();
  expect(sides).toEqual([-1, 1]);
  expect(broken.filter((s) => s.side !== 0).every((s) => s.visible && s.section)).toBe(true);
  await page.screenshot({ path: 'test-results/ship-broken.png' });

  // She is declared sunk some seconds on, and both halves go with her.
  await expect.poll(() => page.evaluate(() => window.__game!.playerCombatant.damage.status), { timeout: 60_000 }).toBe('sunk');
  await framesLater(page, 3);
  expect((await instances(page)).filter((s) => s.visible)).toHaveLength(0);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('damage: a ship that has gone under leaves wreckage and an oil slick on the water, and the sea washes white over her', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  await page.goto(SIDE);
  await waitForFrames(page, 10);
  const kinds = () =>
    page.evaluate(() => {
      const live = (window.__sea!.fx.particles as unknown as { live: { kind: number; life: number; float: number }[] }).live;
      return {
        films: live.filter((p) => p.kind === 2).length,
        floating: live.filter((p) => p.float === p.float && p.kind !== 2 && p.life > 100).length,
        foam: live.filter((p) => p.float === p.float && p.kind !== 2 && p.life < 20).length,
      };
    });
  expect(await kinds()).toEqual({ films: 0, floating: 0, foam: 0 });
  await page.evaluate(() => {
    const d = window.__game!.playerCombatant.damage as unknown as { status: string; sinkTime: number };
    d.status = 'sinking';
    d.sinkTime = 0;
  });
  // While she settles the water boils white over her.
  await simSeconds(page, 3);
  await expect.poll(async () => (await kinds()).foam, { timeout: 10_000 }).toBeGreaterThan(3);
  await page.evaluate(() => {
    (window.__game!.playerCombatant.damage as unknown as { status: string }).status = 'sunk';
  });
  await framesLater(page, 4);
  const after = await kinds();
  expect(after.films).toBeGreaterThanOrEqual(8);
  expect(after.floating).toBeGreaterThanOrEqual(20);
  await simSeconds(page, 20);
  await page.screenshot({ path: 'test-results/ship-aftermath.png' });
  // It floats for minutes: the oil is still on the water twenty seconds on.
  expect((await kinds()).films).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems).toEqual([]);
});

test('damage: a shell bursting near the camera shakes the picture, a distant one does not, and it can be turned off', async ({ page }) => {
  test.setTimeout(120_000);
  const sample = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let max = 0;
          let n = 0;
          const tick = () => {
            const c = window.__camera!;
            max = Math.max(max, Math.abs(c.shakeYawDeg), Math.abs(c.shakePitchDeg));
            if (++n < 25) requestAnimationFrame(tick);
            else resolve(max);
          };
          requestAnimationFrame(tick);
        }),
    );
  await page.goto(TURRET);
  await waitForFrames(page, 10);
  await framesLater(page, 30);
  expect(await sample()).toBe(0);
  // A far burst: nothing.
  await page.evaluate(() => window.__sea!.fx.hitBurst(48, 5, -9000, 0.381, 'ap'));
  expect(await sample()).toBeLessThan(0.01);
  // A burst on the ship beside the camera: the picture is turned by a fraction of a degree.
  await page.evaluate(() => window.__sea!.fx.hitBurst(30, 5, -50, 0.381, 'ap'));
  const shaken = await sample();
  expect(shaken).toBeGreaterThan(0.05);
  expect(shaken).toBeLessThan(1.5);
  // It dies away.
  await page.waitForTimeout(1800);
  expect(await sample()).toBeLessThan(0.02);

  // Turned off in the settings, a burst beside the camera does not move it.
  await page.addInitScript(() => window.localStorage.setItem('fall-of-shot.shake', '0'));
  await page.goto(TURRET);
  await waitForFrames(page, 10);
  await page.evaluate(() => window.__sea!.fx.hitBurst(30, 5, -50, 0.381, 'ap'));
  expect(await sample()).toBe(0);
});

test('damage: a replay of a magazine explosion shows the ship whole, and then breaks her as she broke', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watch(page);
  // The default chase camera and the keys: the replay is asked for with R.
  await page.goto('/?scenario=duel&player=queen-elizabeth&foe=kaiser&trange=9&passive=1&tspd=8&tcrs=0&tele=2&gseed=3&scale=0.5&tscale=1');
  await waitForFrames(page, 10);
  await simSeconds(page, 6);
  await page.evaluate(() => {
    const d = window.__game!.playerCombatant.damage as unknown as { status: string; sinkTime: number; explosionX: number };
    d.explosionX = 12;
    d.status = 'exploded';
    d.sinkTime = 0;
  });
  await simSeconds(page, 3);
  await framesLater(page, 3);
  const live = await instances(page);
  expect(live.filter((s) => s.side !== 0)).toHaveLength(2);

  // Ask for the replay: it begins at the start of what has been recorded, when she was whole.
  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => document.body.dataset.replay), { timeout: 10_000 }).toBe('1');
  await framesLater(page, 3);
  expect((await instances(page)).filter((s) => s.side !== 0)).toHaveLength(0);
  // Played on, she breaks at the moment she did.
  await expect.poll(async () => (await instances(page)).filter((s) => s.side !== 0 && s.visible).length, { timeout: 40_000 }).toBe(2);
  expect(await page.evaluate(() => window.__gpuErrors ?? [])).toEqual([]);
  expect(problems.filter((p) => !/favicon/i.test(p))).toEqual([]);
});
