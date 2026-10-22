import { describe, expect, it } from 'vitest';
import { MineField } from '../src/sim/mines/mines';
import { battleshipHandling, ShipDynamics } from '../src/sim/ships/dynamics';
import { Grounding } from '../src/sim/ships/grounding';
import { SpotterPlane } from '../src/sim/air/spotter';
import { buildTerrain } from '../src/sim/terrain/generate';
import type { TorpedoTarget } from '../src/sim/torpedo/world';

const DEG = Math.PI / 180;

function target(x: number, z: number, heading = 0): TorpedoTarget & { hits: { x: number; warheadKg: number; cause?: string }[] } {
  const hits: { x: number; warheadKg: number; cause?: string }[] = [];
  return {
    id: 1,
    alive: true,
    x,
    z,
    heading,
    halfLength: 80,
    halfBreadthAt: () => 11,
    keelAt: () => 8,
    onTorpedoHit: (h) => hits.push(h),
    hits,
  };
}

describe('mines', () => {
  it('a ship that runs onto one has her hull opened, once', () => {
    const field = new MineField();
    field.add(0, -30);
    const t = target(0, 0);
    const e = field.step([t]);
    expect(e.length).toBe(1);
    expect(t.hits[0]!.cause).toBe('mine');
    expect(t.hits[0]!.warheadKg).toBeGreaterThan(50);
    expect(field.step([t]).length).toBe(0);
  });

  it('a mine well clear of the hull does nothing, and one too shallow for the keel is missed by a boat that draws less', () => {
    const field = new MineField();
    field.add(60, 0);
    field.add(0, 400);
    expect(field.step([target(0, 0)]).length).toBe(0);
    const f2 = new MineField();
    f2.add(0, 0, 12);
    // Horns twelve metres down: the keel at eight metres passes over.
    expect(f2.step([target(0, 0)]).length).toBe(0);
  });

  it('are hidden until spotted, within the aircraft\'s reach only', () => {
    const field = new MineField();
    field.add(100, 100);
    field.add(2000, 100);
    expect(field.mines.every((m) => !m.revealed)).toBe(true);
    expect(field.reveal(0, 0, 400)).toBe(1);
    expect(field.mines[0]!.revealed).toBe(true);
    expect(field.mines[1]!.revealed).toBe(false);
    expect(field.reveal(0, 0, 400)).toBe(0);
  });

  it('a line of them leaves the swept lane open', () => {
    const field = new MineField();
    field.addLine(-1000, 0, 1000, 0, 140, [1100, 1300]);
    const gap = field.mines.filter((m) => m.x > 100 && m.x < 300);
    expect(gap.length).toBe(0);
    expect(field.mines.length).toBeGreaterThan(10);
  });
});

describe('running aground', () => {
  const terrain = buildTerrain(
    {
      x0: -2000,
      z0: -2000,
      width: 4000,
      length: 4000,
      cell: 20,
      seabed: 50,
      masses: [],
      banks: [{ x: 0, z: -600, rx: 500, rz: 500, depth: 5 }],
    },
    2,
  );
  const hull = { length: 160, beam: 25, draft: 8.1 };

  function ship(x: number, z: number, heading = 0, knots = 11): { dyn: ShipDynamics; ground: Grounding } {
    const dyn = new ShipDynamics(battleshipHandling(hull.length, 21));
    dyn.x = x;
    dyn.z = z;
    dyn.heading = heading;
    dyn.setTelegraph(2);
    dyn.speed = knots * 0.514444;
    return { dyn, ground: new Grounding(terrain, hull) };
  }

  it('deep water does not touch her', () => {
    const { dyn, ground } = ship(1200, 1200);
    for (let i = 0; i < 600; i++) {
      ground.begin(dyn);
      dyn.step(1 / 60);
      expect(ground.resolve(dyn).grounded).toBe(false);
    }
  });

  it('a shoal stops her, reports the speed of the strike once, and holds her there', () => {
    const { dyn, ground } = ship(0, 200);
    let impact = 0;
    let strikes = 0;
    for (let i = 0; i < 60 * 120; i++) {
      ground.begin(dyn);
      dyn.step(1 / 60);
      const r = ground.resolve(dyn);
      if (r.impactSpeed > 0) {
        impact = r.impactSpeed;
        strikes++;
      }
    }
    expect(strikes).toBe(1);
    expect(impact).toBeGreaterThan(4);
    expect(ground.grounded).toBe(true);
    expect(Math.abs(dyn.speed)).toBeLessThan(0.2);
    // She has not got any further into the bank than where she struck.
    const stopped = { x: dyn.x, z: dyn.z };
    for (let i = 0; i < 600; i++) {
      ground.begin(dyn);
      dyn.step(1 / 60);
      ground.resolve(dyn);
    }
    expect(dyn.z).toBeGreaterThanOrEqual(stopped.z - 0.5);
  });

  it('she can back off into deeper water, and is then free', () => {
    const { dyn, ground } = ship(0, 200);
    for (let i = 0; i < 60 * 90; i++) {
      ground.begin(dyn);
      dyn.step(1 / 60);
      ground.resolve(dyn);
    }
    expect(ground.grounded).toBe(true);
    dyn.setTelegraph(-2);
    let freeAt = -1;
    for (let i = 0; i < 60 * 600 && freeAt < 0; i++) {
      ground.begin(dyn);
      dyn.step(1 / 60);
      if (!ground.resolve(dyn).grounded) freeAt = i;
    }
    expect(freeAt).toBeGreaterThan(0);
    expect(dyn.speed).toBeLessThan(0);
  });

  it('a draft deeper than the water is aground; one shallower floats over the same bank', () => {
    const g = new Grounding(terrain, hull);
    const d = g.minDepth(0, -600, 0).depth;
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(9);
    const small = new Grounding(terrain, { length: 60, beam: 7, draft: 2.5 });
    const dyn = new ShipDynamics(battleshipHandling(60, 28));
    dyn.x = 0;
    dyn.z = -600;
    small.begin(dyn);
    expect(small.resolve(dyn, 2.5).grounded).toBe(false);
    expect(g.resolve(dyn, 8.1).grounded).toBe(true);
  });
});

describe('the spotter aircraft', () => {
  const hill = buildTerrain({ x0: -3000, z0: -3000, width: 6000, length: 6000, cell: 20, seabed: 50, masses: [{ x: 0, z: 0, rx: 700, rz: 700, peak: 160 }] }, 1);
  const ship = { x: -2500, z: 0 };

  it('is hoisted out, flies, and comes back and rests before it can go up again', () => {
    const plane = new SpotterPlane({ ship: () => ship }, hill);
    expect(plane.ready).toBe(true);
    expect(plane.launch()).toBe(true);
    expect(plane.state).toBe('launching');
    expect(plane.launch()).toBe(false);
    let t = 0;
    while (plane.state !== 'flying' && t < 60) {
      plane.update(1);
      t++;
    }
    expect(plane.state).toBe('flying');
    expect(plane.position()!.altitude).toBeGreaterThan(500);
    plane.recall();
    for (let i = 0; i < 600 && plane.state !== 'deck'; i++) plane.update(1);
    expect(plane.state).toBe('deck');
    expect(plane.ready).toBe(false);
    for (let i = 0; i < 120; i++) plane.update(1);
    expect(plane.ready).toBe(true);
  });

  it('orbits what it is told to watch, and sees over a hill that hides the target from the ship', () => {
    const plane = new SpotterPlane({ ship: () => ship }, hill);
    plane.launch();
    plane.watch(1200, 0);
    for (let i = 0; i < 400; i++) plane.update(1);
    const p = plane.position()!;
    // It circles the point at about its orbit radius, not far off.
    expect(Math.hypot(p.x - 1200, p.z)).toBeLessThan(2200);
    const target = { id: 5, name: 'T', x: 1200, z: 0, vx: 0, vz: 0, heading: 0, halfLength: 20, halfBeam: 10, draft: 2, height: 10, topHeight: 12, deckHeight: 4 };
    // From the ship, low down, the island is in the way.
    expect(hill.blocked(ship.x, 25, ship.z, target.x, target.topHeight, target.z)).toBe(true);
    expect(plane.sees(target)).toBe(true);
  });

  it('spots the mines below it as it flies', () => {
    const field = new MineField();
    // One on the ring the aircraft flies, one a long way from it.
    field.add(2500, 100);
    field.add(-2000, 1500);
    const plane = new SpotterPlane({ ship: () => ship }, hill, (x, z, r) => field.reveal(x, z, r));
    plane.launch();
    plane.watch(1200, 0);
    for (let i = 0; i < 500; i++) plane.update(1);
    expect(field.mines[0]!.revealed).toBe(true);
    expect(field.mines[1]!.revealed).toBe(false);
    void DEG;
  });
});
