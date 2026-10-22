import { describe, expect, it } from 'vitest';
import { narrowsFortSpecs, narrowsMines, narrowsTerrain, NARROWS_START } from '../src/data/missions/narrows';
import { DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { Siege } from '../src/sim/combat/siege';
import { MineField } from '../src/sim/mines/mines';
import { SiegeBot } from '../src/sim/combat/siege-bot';
import { Grounding } from '../src/sim/ships/grounding';

const terrain = narrowsTerrain();

describe('the Narrows', () => {
  it('is a strait with batteries on high ground, and she starts in deep water with the first battery in range', () => {
    const forts = narrowsFortSpecs();
    expect(forts.map((f) => f.name)).toEqual(['Island Battery', 'West Fort', 'East Fort', 'Ridge Howitzers']);
    for (const f of forts) expect(terrain.heightAt(f.x, f.z)).toBeGreaterThan(20);
    expect(terrain.depthAt(NARROWS_START.x, NARROWS_START.z)).toBeGreaterThan(40);
    // The Island Battery is a few kilometres off: the action begins soon, and the throat with its heavy forts is some way on.
    const island = forts[0]!;
    const d = Math.hypot(island.x - NARROWS_START.x, island.z - NARROWS_START.z);
    expect(d).toBeGreaterThan(5000);
    expect(d).toBeLessThan(9000);
  });

  it('the ridge hides the howitzer pits from the strait, and the lookout on its crest sees it', () => {
    const how = narrowsFortSpecs()[3]!;
    const pit = terrain.heightAt(how.x, how.z);
    expect(terrain.blocked(how.x, pit + 4, how.z, 0, 20, how.z)).toBe(true);
    const post = how.observer!;
    expect(terrain.blocked(post.x, terrain.heightAt(post.x, post.z) + post.eye, post.z, 0, 20, post.z)).toBe(false);
  });

  it('the shoals are shallower than the draft and the lanes through the mine lines are free of mines and shoals', () => {
    const draft = DREADNOUGHT_SETUP.ship.hull.draft;
    expect(terrain.depthAt(-700, -300)).toBeLessThan(draft);
    expect(terrain.depthAt(700, 2400)).toBeLessThan(draft);
    const mines = narrowsMines();
    // A ship through the first lane (x about 200 at z -600) and the second (x about -500 at z -3700) is clear of every mine.
    const clear = (x: number, z: number) => mines.mines.every((m) => Math.hypot(m.x - x, m.z - z) > 40);
    expect(clear(200, -600)).toBe(true);
    expect(clear(-500, -3700)).toBe(true);
    expect(mines.mines.length).toBeGreaterThan(20);
    // The lanes' water is deep enough.
    const g = new Grounding(terrain, DREADNOUGHT_SETUP.ship.hull);
    expect(g.minDepth(200, -600, 0).depth).toBeGreaterThan(draft + 5);
    expect(g.minDepth(-500, -3700, 0).depth).toBeGreaterThan(draft + 5);
  });

  it('the aircraft finds the hidden battery, which the ship cannot see, and her fall of shot can then be called', () => {
    const s = new Siege({ seed: 2, terrain, setup: DREADNOUGHT_SETUP, start: { x: 1500, z: 2500, headingDeg: 0 }, forts: narrowsFortSpecs(), mines: narrowsMines() });
    s.dyn.setTelegraph(0);
    s.dyn.speed = 0;
    const how = s.forts[3]!;
    s.plane.launch();
    s.plane.watch(how.x, how.z);
    let found = -1;
    for (let i = 0; i < 60 * 240; i++) {
      s.step(s.player.batteries.map(() => false));
      if (found < 0 && s.plane.sees(how)) found = s.time;
    }
    expect(found).toBeGreaterThan(20);
    // From the ship she is behind the ridge.
    const g = s.player.main;
    g.designate(how);
    for (let i = 0; i < 60 * 40; i++) s.step(s.player.batteries.map(() => false));
    const st = g.status(s.player.cfg.frame());
    expect(st.target!.visible).toBe(false);
    expect(st.target!.spotted).toBe(true);
    // The aircraft's fixes have made a plot.
    expect(g.track.count).toBeGreaterThan(3);
  }, 120_000);

  it('the howitzers fire on a ship in the strait from behind the ridge, and give themselves away by it', () => {
    const s = new Siege({ seed: 4, terrain, setup: DREADNOUGHT_SETUP, start: { x: 150, z: -2300, headingDeg: 0 }, forts: narrowsFortSpecs(), mines: new MineField() });
    s.dyn.setTelegraph(0);
    s.dyn.speed = 0;
    const how = s.forts[3]!;
    expect(how.revealed(0)).toBe(false);
    for (let i = 0; i < 60 * 420; i++) s.step(s.player.batteries.map(() => false));
    expect(how.shellsFired).toBeGreaterThan(0);
    expect(how.revealed(s.time)).toBe(true);
    // The other batteries, close by, have been at it too.
    expect(s.forts.slice(1, 3).some((f) => f.shellsFired > 0)).toBe(true);
    expect(s.player.hitsTaken).toBeGreaterThan(0);
  }, 180_000);

  it('a bombardment from out in the approach silences the island battery without losing the ship', () => {
    const s = new Siege({ seed: 1, terrain, setup: DREADNOUGHT_SETUP, start: NARROWS_START, forts: narrowsFortSpecs(), mines: narrowsMines() });
    const route: [number, number][] = [[-1250, 3400], [-1250, 1800], [-150, 1200], [200, -300]];
    const bot = new SiegeBot(s, route, 'bombard', true, 9500);
    const island = s.forts[0]!;
    while (s.time < 1200 && !island.silenced && !s.lost) s.step(bot.update(s.time));
    expect(island.silenced).toBe(true);
    expect(s.lost).toBe(false);
    expect(s.groundings).toBe(0);
  }, 240_000);
});
