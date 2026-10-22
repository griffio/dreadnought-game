import { describe, expect, it } from 'vitest';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { MAX_FIRES, packFires } from '../src/render/ships/fires';
import { ShipRig } from '../src/render/ships/rig';
import { ReplayRecorder, viewAt, type ShipShot } from '../src/app/replay';

const model = buildShip(DREADNOUGHT);
const DEG = Math.PI / 180;

/** The 16 numbers of a node's matrix. */
const matrix = (rig: ShipRig, node: number): number[] => Array.from(rig.matrices.subarray(node * 16, node * 16 + 16));
/** The same to 32-bit precision (a snapshot keeps its angles as 32-bit numbers). */
const sameMatrices = (a: ShipRig, b: ShipRig): boolean => a.matrices.every((v, i) => Math.abs(v - b.matrices[i]!) < 1e-4);
const isGone = (rig: ShipRig, node: number): boolean => matrix(rig, node).every((v, i) => (i === 15 ? v === 1 : v === 0));

describe('a wrecked turret', () => {
  it('is blown apart: the house is charred and askew, some barrels are gone and the rest hang broken', () => {
    const rig = new ShipRig(model);
    const t = rig.turret('P');
    rig.update();
    const before = matrix(rig, t.houseNode);
    expect(rig.isWrecked('P')).toBe(false);
    rig.wreck('P');
    rig.update();
    expect(rig.isWrecked('P')).toBe(true);
    expect(rig.char[t.houseNode]).toBeGreaterThan(0.8);
    expect(matrix(rig, t.houseNode)).not.toEqual(before);
    const gone = t.barrelNodes.filter((n) => isGone(rig, n));
    // At least one barrel goes and at least one stays.
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.length).toBeLessThan(t.barrelNodes.length);
    for (const n of t.barrelNodes) expect(rig.char[n]).toBe(1);
    for (const n of t.barrelNodes.filter((n) => !isGone(rig, n))) expect(rig.poses[n]!.elevation).toBeLessThan(-10 * DEG);
  });

  it('every turret of every size keeps a barrel and loses one, whichever way the dice fall', () => {
    for (const id of model.turrets.map((t) => t.id)) {
      const rig = new ShipRig(model);
      rig.wreck(id);
      rig.update();
      const t = rig.turret(id);
      const gone = t.barrelNodes.filter((n) => isGone(rig, n)).length;
      expect(gone, id).toBeLessThan(t.barrelNodes.length);
    }
  });

  it('is wrecked the same way every time', () => {
    const a = new ShipRig(model);
    const b = new ShipRig(model);
    a.wreck('X');
    b.wreck('X');
    a.update();
    b.update();
    expect(Array.from(a.matrices)).toEqual(Array.from(b.matrices));
    // But not every turret the same: the house is knocked a different way.
    const c = new ShipRig(model);
    c.wreck('A');
    c.update();
    const tilt = (r: ShipRig, id: string) => r.poses[r.turret(id).houseNode]!.elevation;
    expect(tilt(c, 'A')).not.toBe(tilt(a, 'X'));
  });

  it('no longer trains, elevates or recoils', () => {
    const rig = new ShipRig(model);
    rig.wreck('Y');
    rig.update();
    const frozen = Array.from(rig.matrices);
    rig.setTurret('Y', 1.2, 20 * DEG);
    rig.setRecoil('Y', 0, 1);
    rig.update();
    expect(Array.from(rig.matrices)).toEqual(frozen);
    // The others still do.
    rig.setTurret('X', 1.2, 0);
    rig.update();
    expect(Array.from(rig.matrices)).not.toEqual(frozen);
  });

  it('is put back by repair', () => {
    const fresh = new ShipRig(model);
    fresh.update();
    const rig = new ShipRig(model);
    rig.wreck('P');
    rig.repair('P');
    rig.update();
    expect(Array.from(rig.matrices)).toEqual(Array.from(fresh.matrices));
    expect(Array.from(rig.char).every((c) => c === 0)).toBe(true);
    expect(rig.isWrecked('P')).toBe(false);
  });

  it('ignores a turret that is not there', () => {
    const rig = new ShipRig(model);
    expect(() => rig.wreck('Q')).not.toThrow();
    expect(() => rig.repair('Q')).not.toThrow();
    expect(rig.isWrecked('Q')).toBe(false);
  });

  it('is kept by a replay snapshot, and a replay of an earlier moment puts the turret back', () => {
    const wrecked = new ShipRig(model);
    wrecked.setTurret('A', 0.5, 0.125);
    wrecked.wreck('P');
    const afterwards = wrecked.snapshot();

    const intact = new ShipRig(model);
    intact.setTurret('A', 0.5, 0.125);
    const earlier = intact.snapshot();

    const player = new ShipRig(model);
    player.restore(afterwards);
    player.update();
    wrecked.update();
    expect(player.isWrecked('P')).toBe(true);
    expect(sameMatrices(player, wrecked)).toBe(true);
    expect(Array.from(player.char)).toEqual(Array.from(wrecked.char));

    // Back to the moment before it was hit.
    player.restore(earlier);
    player.update();
    intact.update();
    expect(player.isWrecked('P')).toBe(false);
    expect(sameMatrices(player, intact)).toBe(true);
    expect(Array.from(player.char).every((c) => c === 0)).toBe(true);
  });
});

describe('the fires that light a hull', () => {
  it('are packed four numbers each, with their intensity clamped', () => {
    const out = new Float32Array(MAX_FIRES * 4);
    const n = packFires([{ at: [1, 2, 3], intensity: 0.5 }, { at: [4, 5, 6], intensity: 3 }], out);
    expect(n).toBe(2);
    expect(Array.from(out.subarray(0, 8))).toEqual([1, 2, 3, 0.5, 4, 5, 6, 1]);
    expect(Array.from(out.subarray(8))).toEqual(new Array(MAX_FIRES * 4 - 8).fill(0));
  });

  it('keep the brightest when there are too many', () => {
    const out = new Float32Array(MAX_FIRES * 4);
    const sites = Array.from({ length: 20 }, (_, i) => ({ at: [i, 0, 0] as const, intensity: (i + 1) / 20 }));
    expect(packFires(sites, out)).toBe(MAX_FIRES);
    const xs = Array.from({ length: MAX_FIRES }, (_, i) => out[i * 4]!).sort((a, b) => a - b);
    expect(xs).toEqual(Array.from({ length: MAX_FIRES }, (_, i) => 12 + i));
  });

  it('clear what was there before', () => {
    const out = new Float32Array(MAX_FIRES * 4).fill(7);
    expect(packFires([], out)).toBe(0);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('a replay of damage', () => {
  const shot = (extra: Partial<ShipShot>): ShipShot => ({ x: 0, z: 0, headingDeg: 0, heave: 0, pitch: 0, roll: 0, speed: 0, power: 0, visible: true, guns: new Float32Array(0), ...extra });
  const record = (shots: ShipShot[]): ReplayRecorder => {
    const rec = new ReplayRecorder();
    shots.forEach((s, i) => rec.sample({ t: i / 30, sea: i / 30, ships: [s], shells: [] }));
    return rec;
  };

  it('keeps the fires that lit her hull', () => {
    const rec = record([shot({ fires: [1, 2, 3, 0.5] }), shot({ fires: [1, 2, 3, 0.9] })]);
    expect(viewAt(rec, 0)!.ships[0]!.fires).toEqual([1, 2, 3, 0.5]);
    expect(viewAt(rec, 1 / 30)!.ships[0]!.fires).toEqual([1, 2, 3, 0.9]);
  });

  it('keeps a ship broken in two, moving the halves on between the samples', () => {
    const rec = record([shot({ split: { x: 10, age: 2, sunk: 0.1 } }), shot({ split: { x: 10, age: 2.5, sunk: 0.3 } })]);
    const mid = viewAt(rec, 1 / 60)!.ships[0]!.split!;
    expect(mid.x).toBe(10);
    expect(mid.age).toBeCloseTo(2.25, 6);
    expect(mid.sunk).toBeCloseTo(0.2, 6);
  });

  it('shows her whole before she broke and broken after', () => {
    const rec = record([shot({}), shot({}), shot({ split: { x: 10, age: 0, sunk: 0 } }), shot({ split: { x: 10, age: 0.03, sunk: 0 } })]);
    expect(viewAt(rec, 0)!.ships[0]!.split).toBeUndefined();
    expect(viewAt(rec, 2 / 30)!.ships[0]!.split).toBeDefined();
    expect(viewAt(rec, 3 / 30)!.ships[0]!.split!.age).toBeCloseTo(0.03, 6);
  });
});
