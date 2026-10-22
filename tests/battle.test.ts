import { describe, expect, it } from 'vitest';
import { DESTROYER_SETUP, DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { Battle, type BattleShip } from '../src/sim/combat/battle';
import type { Evasion } from '../src/sim/combat/player-bot';
import { Rng } from '../src/sim/rng';

function attack(seed: number, destroyers: number, evasion: Evasion): Battle {
  const rng = new Rng(seed * 7919);
  const ships: BattleShip[] = [
    { setup: DREADNOUGHT_SETUP, side: 'player', x: 0, z: 0, headingDeg: rng.next() * 360, brain: { kind: 'player-bot', evasion } },
  ];
  for (let i = 0; i < destroyers; i++) {
    const bearing = rng.next() * Math.PI * 2;
    const range = 9000 + rng.next() * 3000;
    ships.push({
      setup: DESTROYER_SETUP,
      side: 'enemy',
      x: Math.sin(bearing) * range,
      z: -Math.cos(bearing) * range,
      headingDeg: rng.next() * 360,
      brain: { kind: 'destroyer' },
    });
  }
  return new Battle({ seed, ships });
}

function campaign(destroyers: number, evasion: Evasion, seeds: number[]) {
  let launched = 0;
  let hits = 0;
  let lost = 0;
  let destroyersBeaten = 0;
  for (const seed of seeds) {
    const b = attack(seed, destroyers, evasion);
    b.run(900);
    launched += b.arena.torpedoes.launched;
    hits += b.torpedoEvents.filter((e) => e.kind === 'hit' && e.targetId === b.player.id).length;
    if (b.outcome === 'player-lost') lost++;
    destroyersBeaten += b.enemies.filter((c) => c.damage.status === 'struck' || !c.damage.floating).length;
  }
  return { launched, hits, lost, destroyersBeaten };
}

describe('the destroyer attack, headless', () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  // A single boat is a small sample: the tests that count what happens to her use twice as many fights.
  const more = [...seeds, 7, 8, 9, 10, 11, 12];

  it('a destroyer runs in, fires a fan, and a ship that does nothing about it is hit now and then', () => {
    const r = campaign(1, 'none', more);
    // Some of them are sunk or struck before they are in position, but most get a fan away.
    expect(r.launched).toBeGreaterThanOrEqual(more.length * 0.75);
    expect(r.hits).toBeGreaterThanOrEqual(1);
    expect(r.hits).toBeLessThanOrEqual(r.launched * 0.6);
  }, 300_000);

  it('turning toward the wakes turns most of the fan aside', () => {
    const passive = campaign(2, 'none', seeds);
    const alert = campaign(2, 'head-on', seeds);
    expect(alert.hits).toBeLessThan(passive.hits * 0.6);
    expect(alert.lost).toBe(0);
  }, 240_000);

  it('the secondary battery makes her pay for the run: most of the destroyers are beaten before the end', () => {
    const r = campaign(1, 'head-on', more);
    expect(r.destroyersBeaten).toBeGreaterThanOrEqual(more.length * 0.7);
  }, 300_000);

  it('smoke across the line of sight shuts the rangefinder, and the plot goes on from where it was', () => {
    const b = new Battle({
      seed: 4,
      ships: [
        { setup: DREADNOUGHT_SETUP, side: 'player', x: 0, z: 0, headingDeg: 0, brain: { kind: 'player-bot', evasion: 'none' } },
        // A boat slow to gather way, so that the plot is steady while the smoke is across the line: the test is of the smoke.
        { setup: { ...DESTROYER_SETUP, handling: undefined }, side: 'enemy', x: 9000, z: 0, headingDeg: 0, startKnots: 0, brain: { kind: 'destroyer' } },
      ],
    });
    const gun = b.player.main;
    const status = () => gun.status(b.player.cfg.frame());
    while (b.time < 60) b.step();
    expect(status().target?.clarity).toBe(1);
    const before = gun.track.count;
    expect(before).toBeGreaterThan(5);

    // A wall of smoke halfway across the line.
    const foe = b.enemies[0]!;
    const mx = (b.player.x + foe.x) / 2;
    const mz = (b.player.z + foe.z) / 2;
    // Perpendicular to the line between them.
    const len = Math.hypot(foe.x - b.player.x, foe.z - b.player.z);
    const px = -(foe.z - b.player.z) / len;
    const pz = (foe.x - b.player.x) / len;
    // As a destroyer's trail is laid: a puff every dozen metres or so.
    for (let i = -50; i <= 50; i++) b.arena.smoke.emit(mx + px * i * 14, mz + pz * i * 14);
    while (b.time < 70) b.step();
    expect(status().target!.clarity).toBeLessThan(0.1);
    expect(status().target!.visible).toBe(false);
    expect(gun.track.count).toBeLessThanOrEqual(before);

    b.arena.smoke.clear();
    while (b.time < 90) b.step();
    expect(status().target!.visible).toBe(true);
    expect(gun.track.count).toBeGreaterThan(before - 2);
  }, 60_000);

  it('a destroyer that has fired lays smoke as she turns away', () => {
    let laid = 0;
    for (const seed of [1, 2, 3, 4]) {
      const b = attack(seed, 1, 'head-on');
      while (b.time < 700 && b.outcome === 'running') {
        b.step();
        laid = Math.max(laid, b.arena.smoke.clouds.length);
      }
    }
    expect(laid).toBeGreaterThan(5);
  }, 120_000);

  it('is deterministic', () => {
    const run = () => {
      const b = attack(3, 2, 'none');
      b.run(600);
      return JSON.stringify([b.player.damage.summary(), b.arena.torpedoes.launched, b.torpedoEvents.length, b.enemies.map((c) => c.damage.status)]);
    };
    expect(run()).toBe(run());
  }, 60_000);
});
