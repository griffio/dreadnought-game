import { describe, expect, it } from 'vitest';
import { fortShipSpec } from '../src/data/forts/fort-model';
import { Fort, type FortSpec } from '../src/sim/fort/fort';
import { CALM } from '../src/sim/gunnery/ballistics';
import { GUN_12_45_MK_X, GUN_15_40_COAST, GUN_17_40_SK } from '../src/sim/gunnery/guns';
import { mountsFromSpec } from '../src/sim/gunnery/mounts';
import { RANGEFINDER_9FT } from '../src/sim/gunnery/rangefinder';
import { ARCADE } from '../src/sim/pace';
import type { ImpactInfo, LiveShell, ShellEvent } from '../src/sim/gunnery/shell-world';
import { Terrain } from '../src/sim/terrain/terrain';

const ground = (height = 40): Terrain => new Terrain({ x0: -1000, z0: -1000, cell: 20, nx: 101, nz: 101, heights: new Float32Array(101 * 101).fill(height) });

const SPEC: FortSpec = {
  id: 't',
  name: 'Test Battery',
  x: 0,
  z: 0,
  gun: GUN_15_40_COAST,
  rangefinder: RANGEFINDER_9FT,
  eye: 10,
  ammunition: 50,
  emplacements: [
    { id: 'P1', dx: -30, dz: 0, frontMm: 0, roofMm: 0, radius: 7, height: 1.8 },
    { id: 'C1', dx: 0, dz: 0, frontMm: 120, roofMm: 150, radius: 6, height: 4, arc: { centreDeg: 90, halfDeg: 80 } },
    { id: 'C2', dx: 30, dz: 0, frontMm: 120, roofMm: 150, radius: 6, height: 4, arc: { centreDeg: 90, halfDeg: 80 } },
  ],
};

function make(spec: FortSpec = SPEC, height = 40): Fort {
  return new Fort({ spec, mounts: mountsFromSpec(fortShipSpec(spec)), terrain: ground(height), env: () => CALM, visibilityKm: () => 40, seed: 3, id: 101 });
}

describe('a fort at the arcade pace', () => {
  it('reloads and swings her guns faster, and plots faster, without touching the gun in the data file', () => {
    const real = make();
    const quick = new Fort({ spec: SPEC, mounts: mountsFromSpec(fortShipSpec(SPEC)), terrain: ground(40), env: () => CALM, visibilityKm: () => 40, seed: 3, id: 102, pace: ARCADE });
    expect(real.gunnery.battery.gun.reloadSeconds).toBe(GUN_15_40_COAST.reloadSeconds);
    expect(quick.gunnery.battery.gun.reloadSeconds).toBeCloseTo(GUN_15_40_COAST.reloadSeconds / ARCADE.reload, 6);
    expect(quick.gunnery.battery.gun.trainRateDegPerSec).toBeGreaterThan(GUN_15_40_COAST.trainRateDegPerSec * 2);
    expect(GUN_15_40_COAST.reloadSeconds).toBe(real.gunnery.battery.gun.reloadSeconds);
  });
});

function shell(gun = GUN_12_45_MK_X, fuze?: 'impact'): LiveShell {
  return { id: 1, salvo: 1, shooter: 1, spec: fuze ? { ...gun.shell, fuze } : gun.shell, state: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 }, passed: [] };
}

/** A shell that comes down on a position at the given speed and (steep or flat) angle. */
function strike(f: Fort, id: string, speed: number, dive: number, gun = GUN_12_45_MK_X, fuze?: 'impact'): ReturnType<Fort['resolveHit']> {
  const e = f.emplacements.find((p) => p.spec.id === id)!;
  const vy = -speed * dive;
  const vh = Math.sqrt(speed * speed - vy * vy);
  const info: ImpactInfo = {
    shell: shell(gun, fuze),
    from: [e.worldX, f.base + 3, e.worldZ + 4],
    to: [e.worldX, f.base + 0.5, e.worldZ],
    velocity: [0, vy, -vh],
  };
  return f.resolveHit(info);
}

describe('a fort', () => {
  it('stands on the ground and is aimed at its first working position', () => {
    const f = make();
    expect(f.base).toBe(40);
    expect(f.topHeight).toBeGreaterThan(f.base);
    expect(f.draft).toBe(-40);
    expect(f.gunsLeft).toBe(3);
    expect(f.aimX).toBe(-30);
    expect(f.silenced).toBe(false);
  });

  it('a heavy shell through the roof wrecks a casemate gun, and the aim moves on when its position is gone', () => {
    const f = make();
    const epoch0 = f.aimEpoch;
    // Wreck the open pit first: the aim point passes to the next position and the plot is begun again.
    expect(strike(f, 'P1', 700, 0.2)).not.toBeNull();
    expect(f.emplacements[0]!.state).toBe('wrecked');
    expect(f.aimX).toBe(0);
    expect(f.aimEpoch).toBeGreaterThan(epoch0);
    // A 12-inch coming down at 60 degrees defeats 150 mm of roof.
    const r = strike(f, 'C1', 600, 0.87)!;
    expect(r.kind).toBe('burst');
    expect(f.emplacements[1]!.state).toBe('wrecked');
    expect(f.hitsTaken).toBe(2);
  });

  it('a light shell shatters on the casemate front, and shakes the crew instead', () => {
    const f = make();
    const r = strike(f, 'C2', 600, 0.1, GUN_17_40_SK)!;
    expect(r.kind).not.toBe('burst');
    expect(f.emplacements[2]!.state).toBe('ready');
    expect(f.suppression).toBeGreaterThan(0);
  });

  it('a wrecked position is rubble: shells go through it to the ground behind', () => {
    const f = make();
    strike(f, 'P1', 700, 0.2);
    expect(strike(f, 'P1', 700, 0.2)).toBeNull();
  });

  it('shells that fall close shake the crews and fade; a fall far away does nothing', () => {
    const f = make();
    const fall = (x: number, z: number): ShellEvent => ({ kind: 'ground', shell: shell(), x, y: 40, z, speed: 500, angleDeg: 10 });
    f.receive(fall(400, 400));
    expect(f.suppression).toBe(0);
    f.receive(fall(-26, 5));
    f.receive(fall(-33, -4));
    const after = f.suppression;
    expect(after).toBeGreaterThan(0.1);
    // Left alone the crews recover.
    for (let i = 0; i < 60 * 60; i++) f.step(1 / 60, i / 60);
    expect(f.suppression).toBeLessThan(after);
  });

  it('is silenced when every position is out, and then counts as struck', () => {
    const f = make();
    for (const e of f.emplacements) e.state = 'wrecked';
    expect(f.silenced).toBe(true);
    expect(f.struck).toBe(true);
    expect(f.gunsLeft).toBe(0);
  });

  it('is out of ammunition when the magazines are empty', () => {
    const f = make();
    for (const e of f.emplacements) e.rounds = 0;
    expect(f.silenced).toBe(true);
  });

  it('a hidden battery is known only once her flash has been seen', () => {
    const f = make({ ...SPEC, hidden: true });
    expect(f.revealed(0)).toBe(false);
    f.revealedUntil = 100;
    expect(f.revealed(50)).toBe(true);
    expect(f.revealed(150)).toBe(false);
  });

  it('opens fire on a ship that comes in sight and range, and not on one beyond her guns', () => {
    const f = make();
    const ship = { id: 1, name: 'Ship', x: 0, z: 9000, vx: 0, vz: 0, heading: 0, halfLength: 80, halfBeam: 12, draft: 8, height: 40, topHeight: 30, deckHeight: 6, alive: true };
    const far = { ...ship, id: 2, z: 30000 };
    f.setOpponents([ship, far]);
    let fired = 0;
    f.gunnery.onShot = () => fired++;
    for (let i = 0; i < 60 * 90; i++) f.step(1 / 60, i / 60);
    expect(f.gunnery.target?.id).toBe(1);
    expect(fired).toBeGreaterThan(0);
  });
});
