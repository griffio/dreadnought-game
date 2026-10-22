import { describe, expect, it } from 'vitest';
import { battleshipHandling, KNOT, ShipDynamics, TELEGRAPH } from '../src/sim/ships/dynamics';

const L = 160.6;
const make = () => new ShipDynamics(battleshipHandling(L, 21));

function run(ship: ShipDynamics, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) ship.step(dt);
}

describe('ShipDynamics: engines', () => {
  it('builds speed slowly toward the ordered speed and does not overshoot', () => {
    const ship = make();
    ship.setTelegraph(TELEGRAPH.FULL_AHEAD);
    run(ship, 20);
    expect(ship.speedKnots).toBeGreaterThan(2);
    expect(ship.speedKnots).toBeLessThan(10); // a battleship does not leap to speed
    let peak = 0;
    for (let t = 0; t < 400; t++) {
      run(ship, 1);
      peak = Math.max(peak, ship.speed);
    }
    expect(ship.speed / KNOT).toBeCloseTo(0.8 * 21, 0);
    expect(peak / KNOT).toBeLessThanOrEqual(0.8 * 21 + 0.05);
  });

  it('flank is faster than full ahead, astern is slower than ahead', () => {
    const a = make();
    a.setTelegraph(TELEGRAPH.FLANK);
    run(a, 600);
    const b = make();
    b.setTelegraph(TELEGRAPH.FULL_ASTERN);
    run(b, 600);
    expect(a.speedKnots).toBeCloseTo(21, 0);
    expect(b.speedKnots).toBeLessThan(0);
    expect(Math.abs(b.speedKnots)).toBeLessThan(a.speedKnots * 0.5);
  });

  it('coasts a long way after the engines are stopped', () => {
    const ship = make();
    ship.setTelegraph(TELEGRAPH.FLANK);
    run(ship, 400);
    const start = { x: ship.x, z: ship.z };
    ship.setTelegraph(TELEGRAPH.STOP);
    run(ship, 90);
    expect(ship.speedKnots).toBeGreaterThan(5);
    run(ship, 300);
    const travelled = Math.hypot(ship.x - start.x, ship.z - start.z);
    expect(travelled).toBeGreaterThan(900); // six-plus hull lengths on a stopped engine
    expect(ship.speedKnots).toBeLessThan(2);
  });

  it('reversing the engines stops the ship faster than coasting', () => {
    const coast = make();
    const brake = make();
    for (const s of [coast, brake]) {
      s.setTelegraph(TELEGRAPH.FLANK);
      run(s, 400);
    }
    coast.setTelegraph(TELEGRAPH.STOP);
    brake.setTelegraph(TELEGRAPH.FULL_ASTERN);
    run(coast, 120);
    run(brake, 120);
    expect(brake.speed).toBeLessThan(coast.speed * 0.6);
  });

  it('clamps and rounds telegraph orders', () => {
    const ship = make();
    ship.setTelegraph(99);
    expect(ship.telegraph).toBe(TELEGRAPH.FLANK);
    ship.setTelegraph(-99);
    expect(ship.telegraph).toBe(TELEGRAPH.FULL_ASTERN);
    ship.stepTelegraph(3);
    expect(ship.telegraph).toBe(0);
  });
});

describe('ShipDynamics: steering', () => {
  const cruising = () => {
    const ship = make();
    ship.setTelegraph(TELEGRAPH.FULL_AHEAD);
    run(ship, 400);
    return ship;
  };

  it('holds heading and moves along it with the rudder amidships', () => {
    const ship = make();
    ship.heading = Math.PI / 2; // east
    ship.setTelegraph(TELEGRAPH.HALF_AHEAD);
    run(ship, 120);
    expect(ship.headingDeg).toBeCloseTo(90, 5);
    expect(ship.x).toBeGreaterThan(300);
    expect(Math.abs(ship.z)).toBeLessThan(1e-6);
  });

  it('moves the rudder at the steering-gear rate, not instantly', () => {
    const ship = make();
    ship.setRudderOrder(1);
    run(ship, 5);
    expect(ship.rudderDeg).toBeCloseTo(5 * 2.3, 1);
    run(ship, 20);
    expect(ship.rudderDeg).toBeCloseTo(35, 3);
  });

  it('turns to starboard with positive rudder and to port with negative', () => {
    const a = cruising();
    a.setRudderOrder(0.5);
    run(a, 60);
    const b = cruising();
    b.setRudderOrder(-0.5);
    run(b, 60);
    expect(a.headingDeg).toBeGreaterThan(5);
    expect(a.headingDeg).toBeLessThan(180);
    expect(b.headingDeg).toBeGreaterThan(180); // wrapped to the 300s
  });

  it('hard rudder makes a turning circle of roughly three hull lengths and sheds speed', () => {
    const ship = cruising();
    const v0 = ship.speed;
    ship.setRudderOrder(1);
    // Let the turn settle, then follow it round a full circle.
    run(ship, 90);
    const points: [number, number][] = [];
    const start = ship.heading;
    let turned = 0;
    let last = ship.heading;
    while (turned < Math.PI * 2 && points.length < 100000) {
      ship.step(1 / 60);
      turned += ship.heading - last;
      last = ship.heading;
      points.push([ship.x, ship.z]);
    }
    void start;
    const xs = points.map((p) => p[0]);
    const zs = points.map((p) => p[1]);
    const diameter = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    expect(diameter / L).toBeGreaterThan(2.3);
    expect(diameter / L).toBeLessThan(4.6);
    expect(ship.speed).toBeLessThan(v0 * 0.88);
    expect(ship.speed).toBeGreaterThan(v0 * 0.55);
  });

  it('cannot steer with no way on and the engines stopped', () => {
    const ship = make();
    ship.setRudderOrder(1);
    run(ship, 120);
    expect(ship.headingDeg).toBeCloseTo(0, 5);
  });

  it('has some steering at low speed with the engines turning (propeller wash)', () => {
    const ship = make();
    ship.setTelegraph(TELEGRAPH.SLOW_AHEAD);
    ship.setRudderOrder(1);
    run(ship, 60);
    expect(Math.abs(ship.yawRate)).toBeGreaterThan(0);
    expect(ship.headingDeg).toBeGreaterThan(0.5);
  });

  it('going astern reverses the steering sense', () => {
    const ahead = make();
    ahead.setTelegraph(TELEGRAPH.HALF_AHEAD);
    ahead.setRudderOrder(1);
    const astern = make();
    astern.setTelegraph(TELEGRAPH.HALF_ASTERN);
    astern.setRudderOrder(1);
    run(ahead, 200);
    run(astern, 200);
    expect(Math.sign(ahead.yawRate)).toBe(1);
    expect(Math.sign(astern.yawRate)).toBe(-1);
  });
});

describe('turn heel', () => {
  it('leans outward: a starboard turn heels to port (negative), and the reverse', () => {
    const a = make();
    a.setTelegraph(TELEGRAPH.FLANK);
    run(a, 300);
    a.setRudderOrder(1);
    run(a, 60);
    expect(a.turnHeel).toBeLessThan(-0.005);
    const b = make();
    b.setTelegraph(TELEGRAPH.FLANK);
    run(b, 300);
    b.setRudderOrder(-1);
    run(b, 60);
    expect(b.turnHeel).toBeGreaterThan(0.005);
  });

  it('is zero in a straight line', () => {
    const s = make();
    s.setTelegraph(TELEGRAPH.FLANK);
    run(s, 200);
    expect(Math.abs(s.turnHeel)).toBeLessThan(1e-9);
  });
});
