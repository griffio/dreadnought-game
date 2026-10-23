import { describe, expect, it } from 'vitest';
import { DREADNOUGHT_SETUP } from '../src/data/ships/fleet';
import { DECAL_FLOATS, DECAL_HOLE, DECAL_SCORCH, DECAL_SOFT, DecalSet, decalsForHit, markable, MAX_DECALS, type Decal, type HitMark } from '../src/render/ships/decals';
import { Combatant } from '../src/sim/combat/combatant';
import { CALM } from '../src/sim/gunnery/ballistics';
import { GUN_12_45_MK_X } from '../src/sim/gunnery/guns';
import type { ImpactInfo, LiveShell } from '../src/sim/gunnery/shell-world';
import { battleshipHandling, ShipDynamics } from '../src/sim/ships/dynamics';

const decal = (i: number, over: Partial<Decal> = {}): Decal => ({ x: i, y: 3, z: 12, radius: 1, nx: 0, ny: 0, nz: 1, kind: DECAL_HOLE, created: i, seed: 0.5, ...over });
const mark = (over: Partial<HitMark> = {}): HitMark => ({ at: [10, 3, 12.5], normal: [0, 0, 1], caliberM: 0.305, kind: 'burst', plate: 'side', ...over });

describe('the decal set', () => {
  it('keeps the last MAX_DECALS: a new one overwrites the oldest', () => {
    const set = new DecalSet();
    for (let i = 0; i < MAX_DECALS; i++) set.add(decal(i));
    expect(set.count).toBe(MAX_DECALS);
    set.add(decal(100));
    set.add(decal(101));
    expect(set.count).toBe(MAX_DECALS);
    expect(set.items.some((d) => d.created === 0)).toBe(false);
    expect(set.items.some((d) => d.created === 1)).toBe(false);
    expect(set.items.some((d) => d.created === 2)).toBe(true);
    expect(set.items.some((d) => d.created === 101)).toBe(true);
  });

  it('packs three vec4s each, as the shader reads them, and clears what it does not fill', () => {
    const set = new DecalSet();
    set.add(decal(7, { x: 1, y: 2, z: 3, radius: 4, nx: 0.5, ny: 0.25, nz: 0.125, kind: DECAL_SCORCH, created: 9.5, seed: 0.75 }));
    const out = new Float32Array(MAX_DECALS * DECAL_FLOATS).fill(99);
    set.pack(out, 0);
    expect([...out.slice(0, 10)]).toEqual([1, 2, 3, 4, 0.5, 0.25, 0.125, DECAL_SCORCH, 9.5, 0.75]);
    expect(out[DECAL_FLOATS]).toBe(0);
    expect(out[out.length - 1]).toBe(0);
  });
});

describe('what a hit leaves', () => {
  it('a shell that bursts inside makes a hole and a wide scorch around it', () => {
    const [scorch, hole] = decalsForHit(mark(), 12);
    expect(scorch!.kind).toBe(DECAL_SCORCH);
    expect(hole!.kind).toBe(DECAL_HOLE);
    expect(scorch!.radius).toBeGreaterThan(hole!.radius * 2);
    expect(hole!.created).toBe(12);
    // Both are on the plate, facing the way it faces.
    for (const d of [scorch!, hole!]) expect([d.x, d.y, d.z, d.nx, d.ny, d.nz]).toEqual([10, 3, 12.5, 0, 0, 1]);
  });

  it('a bigger shell makes a bigger mark', () => {
    const small = decalsForHit(mark({ caliberM: 0.152 }), 0)[1]!;
    const big = decalsForHit(mark({ caliberM: 0.381 }), 0)[1]!;
    expect(big.radius).toBeGreaterThan(small.radius * 1.8);
  });

  it('a shell through light structure leaves a clean small hole, one that breaks up a soft scorch, a glancing one a scuff', () => {
    expect(decalsForHit(mark({ kind: 'pass' }), 0).map((d) => d.kind)).toEqual([DECAL_HOLE]);
    const broke = decalsForHit(mark({ kind: 'shatter' }), 0);
    expect(broke.map((d) => d.kind)).toEqual([DECAL_SOFT]);
    const glance = decalsForHit(mark({ kind: 'ricochet' }), 0);
    expect(glance[0]!.radius).toBeLessThan(broke[0]!.radius);
  });

  it('leaves nothing on a turret (it turns), on the bottom, or under the water', () => {
    expect(markable('side')).toBe(true);
    expect(markable('belt')).toBe(true);
    expect(markable('deck')).toBe(true);
    expect(markable('turret')).toBe(false);
    expect(decalsForHit(mark({ plate: 'turret' }), 0)).toEqual([]);
    expect(decalsForHit(mark({ plate: 'bottom' }), 0)).toEqual([]);
    expect(decalsForHit(mark({ at: [10, -2, 12.5] }), 0)).toEqual([]);
  });

  it('turns two hits differently, and the same hit the same way', () => {
    const a = decalsForHit(mark(), 5)[1]!;
    const b = decalsForHit(mark({ at: [40, 4, 12.5] }), 5)[1]!;
    expect(a.seed).not.toBe(b.seed);
    expect(decalsForHit(mark(), 5)[1]!.seed).toBe(a.seed);
    expect(a.seed).toBeGreaterThanOrEqual(0);
    expect(a.seed).toBeLessThan(1);
  });
});

function make(): Combatant {
  const setup = DREADNOUGHT_SETUP;
  const dynamics = new ShipDynamics(battleshipHandling(setup.ship.hull.length, setup.maxSpeedKn));
  return new Combatant({
    id: 7,
    name: setup.name,
    ship: setup.ship,
    damage: setup.damage,
    dynamics,
    frame: () => ({ x: dynamics.x, y: 0, z: dynamics.z, heading: dynamics.heading, pitch: 0, roll: 0, vx: 0, vz: 0 }),
    batteries: setup.batteries,
    rangefinder: setup.rangefinder,
    env: () => CALM,
    visibilityKm: () => 40,
    seed: 1,
  });
}

const live: LiveShell = { id: 1, salvo: 1, shooter: 99, spec: GUN_12_45_MK_X.shell, state: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 }, passed: [], prevX: 0, prevY: 0, prevZ: 0 };

/** A step of a shell travelling west (-x) at `speed`, descending at `descent` degrees, reaching x = `atX` at height y. */
function stepWest(atX: number, y: number, z: number, speed: number, descent: number): ImpactInfo {
  const a = (descent * Math.PI) / 180;
  const vx = -Math.cos(a) * speed;
  const vy = -Math.sin(a) * speed;
  const dt = 1 / 60;
  return { shell: live, from: [atX - vx * dt, y - vy * dt, z], to: [atX, y, z], velocity: [vx, vy, 0] };
}

describe('a Combatant reports where she was struck', () => {
  it('a burst through her starboard side is a mark facing starboard, on a plate of her hull', () => {
    const c = make();
    const marks: HitMark[] = [];
    c.onHitMark = (m) => marks.push(m);
    // The ship heads north, so her starboard side faces east: a shell from the east, travelling west, strikes it.
    expect(c.resolveHit(stepWest(10.8, 0.4, -30, 700, 2))?.kind).toBe('burst');
    expect(marks).toHaveLength(1);
    const m = marks[0]!;
    expect(m.kind).toBe('burst');
    expect(m.normal).toEqual([0, 0, 1]);
    expect(markable(m.plate)).toBe(true);
    expect(m.caliberM).toBeCloseTo(0.305, 3);
    // Ship space: x forward (north is -z in the world, so a shell 30 m north of amidships is 30 m forward), z to starboard.
    expect(m.at[0]).toBeGreaterThan(20);
    expect(m.at[2]).toBeGreaterThan(8);
    // And it is a mark the ship will carry.
    expect(decalsForHit(m, 3).length).toBeGreaterThan(0);
  });

  it('a shell that breaks up on the belt is a mark too, and one that misses leaves none', () => {
    const c = make();
    const marks: HitMark[] = [];
    c.onHitMark = (m) => marks.push(m);
    expect(c.resolveHit(stepWest(10.8, 0.4, -30, 430, 9))?.kind).toBe('shatter');
    expect(marks.map((m) => m.kind)).toEqual(['shatter']);
    c.resolveHit(stepWest(0, 60, 0, 600, 5));
    expect(marks).toHaveLength(1);
  });
});
