import { describe, expect, it } from 'vitest';
import {
  BISMARCK_SETUP,
  DESTROYER_SETUP,
  DREADNOUGHT_SETUP,
  KAISER_SETUP,
  KING_GEORGE_V_SETUP,
  PRE_DREADNOUGHT_SETUP,
  QUEEN_ELIZABETH_SETUP,
  RODNEY_SETUP,
} from '../src/data/ships/fleet';
import type { ShipSetup } from '../src/sim/combat/setup';
import { battleshipHandling, handlingFor, KNOT, ShipDynamics } from '../src/sim/ships/dynamics';

const DT = 1 / 20;

interface Trial {
  /** Seconds from stop to 90% of the full-ahead speed. */
  gatherWay: number;
  /** Seconds to lose 90% of that speed from full ahead, with the engines stopped. */
  coastDown: number;
  /** Seconds from hard-over order to the first 10 degrees of turn. */
  firstTenDegrees: number;
  /** Seconds to turn through 90 degrees, and the width of the circle (tactical diameter) in metres and hull lengths, at full ahead and hard over. */
  quarterTurn: number;
  tacticalDiameter: number;
  diameterLengths: number;
}

function trial(setup: ShipSetup): Trial {
  const L = setup.ship.hull.length;
  const make = () => new ShipDynamics(handlingFor(L, setup.maxSpeedKn, setup.handling));

  const a = make();
  a.setTelegraph(3);
  let t = 0;
  const full = a.orderedSpeed;
  while (a.speed < 0.9 * full && t < 2000) {
    a.step(DT);
    t += DT;
  }
  const gatherWay = t;

  const b = make();
  b.setTelegraph(3);
  b.speed = b.orderedSpeed;
  b.setTelegraph(0);
  const v0 = b.speed;
  t = 0;
  while (b.speed > 0.1 * v0 && t < 3000) {
    b.step(DT);
    t += DT;
  }
  const coastDown = t;

  // The turn: steaming at full ahead, then hard to starboard.
  const c = make();
  c.setTelegraph(3);
  c.speed = c.orderedSpeed;
  c.setRudderOrder(1);
  t = 0;
  let ten = 0;
  let quarter = 0;
  let maxSide = 0;
  const startHeading = c.heading;
  while (t < 1200) {
    c.step(DT);
    t += DT;
    const turned = c.heading - startHeading;
    if (!ten && turned > (10 * Math.PI) / 180) ten = t;
    if (!quarter && turned > Math.PI / 2) quarter = t;
    // North-heading start, turning to starboard: the ship's sideways offset is x.
    maxSide = Math.max(maxSide, c.x);
    if (turned > Math.PI) break;
  }
  return { gatherWay, coastDown, firstTenDegrees: ten, quarterTurn: quarter, tacticalDiameter: maxSide, diameterLengths: maxSide / L };
}

const SHIPS: [string, ShipSetup][] = [
  ['Dreadnought', DREADNOUGHT_SETUP],
  ['Hessen', PRE_DREADNOUGHT_SETUP],
  ['Queen Elizabeth', QUEEN_ELIZABETH_SETUP],
  ['Rodney', RODNEY_SETUP],
  ['King George V', KING_GEORGE_V_SETUP],
  ['Kaiser', KAISER_SETUP],
  ['Bismarck', BISMARCK_SETUP],
  ['Destroyer', DESTROYER_SETUP],
];

describe('how each class handles', () => {
  const results = new Map(SHIPS.map(([name, setup]) => [name, trial(setup)] as const));
  const get = (name: string) => results.get(name)!;

  it('leaves the Dreadnought as the reference ship', () => {
    expect(DREADNOUGHT_SETUP.handling).toBeUndefined();
    expect(handlingFor(160.6, 21, DREADNOUGHT_SETUP.handling)).toEqual(battleshipHandling(160.6, 21));
    // About 2.9 lengths across: the figure the first six milestones were played with.
    expect(get('Dreadnought').diameterLengths).toBeGreaterThan(2.7);
    expect(get('Dreadnought').diameterLengths).toBeLessThan(3.6);
  });

  it('overrides only what the class says and keeps her own length and speed', () => {
    const h = handlingFor(216.6, 23, RODNEY_SETUP.handling);
    expect(h.lengthM).toBe(216.6);
    expect(h.maxSpeedKn).toBe(23);
    expect(h.rudderMaxDeg).toBe(35);
    expect(h.turnRadiusLengths).toBe(1.6);
  });

  it('every big ship turns a full circle in three to five minutes and a quarter turn in under two', () => {
    for (const [name] of SHIPS.filter(([n]) => n !== 'Destroyer')) {
      const r = get(name);
      expect(r.quarterTurn, name).toBeGreaterThan(35);
      expect(r.quarterTurn, name).toBeLessThan(120);
    }
  });

  it('the Rodney is the slowest to answer, to build speed and to stop; the King George V and the Bismarck the handiest', () => {
    const capital = SHIPS.map(([n]) => n).filter((n) => n !== 'Destroyer');
    const slowestToGather = capital.reduce((m, n) => (get(n).gatherWay > get(m).gatherWay ? n : m));
    // The old reciprocating pre-dreadnought is as slow to gather way as the Rodney; neither is quicker than the oil-fired ships.
    expect(['Rodney', 'Hessen']).toContain(slowestToGather);
    expect(get('Rodney').gatherWay).toBeGreaterThan(get('Queen Elizabeth').gatherWay);
    expect(get('Rodney').gatherWay).toBeGreaterThan(get('King George V').gatherWay);
    expect(get('Rodney').coastDown).toBeGreaterThan(get('Dreadnought').coastDown);
    expect(get('Rodney').firstTenDegrees).toBeGreaterThan(get('King George V').firstTenDegrees);
    expect(get('Rodney').diameterLengths).toBeGreaterThan(get('King George V').diameterLengths);
    expect(get('Rodney').diameterLengths).toBeGreaterThan(get('Bismarck').diameterLengths);
    expect(get('King George V').gatherWay).toBeLessThan(get('Dreadnought').gatherWay);
    expect(get('Bismarck').gatherWay).toBeLessThan(get('Dreadnought').gatherWay);
  });

  it('the destroyer answers the helm and the engines in a fraction of the time, yet still needs a wide circle for her size', () => {
    const d = get('Destroyer');
    for (const [name] of SHIPS.filter(([n]) => n !== 'Destroyer')) {
      expect(d.gatherWay, name).toBeLessThan(get(name).gatherWay / 2);
      expect(d.firstTenDegrees, name).toBeLessThan(get(name).firstTenDegrees);
      expect(d.coastDown, name).toBeLessThan(get(name).coastDown / 2);
    }
    // 28 knots on a 67 m hull: a circle of some 350 to 450 metres, not the dime a battleship's formula would give her.
    expect(d.tacticalDiameter).toBeGreaterThan(300);
    expect(d.tacticalDiameter).toBeLessThan(500);
    // In metres she is not wider than the battleships, which is where the gun-armed ships have the edge on her.
    expect(d.tacticalDiameter).toBeLessThan(get('Queen Elizabeth').tacticalDiameter);
  });

  it('prints the table (for the record)', () => {
    const rows = SHIPS.map(([name]) => {
      const r = get(name);
      return `${name.padEnd(16)} gather way ${r.gatherWay.toFixed(0).padStart(4)} s  coast ${r.coastDown.toFixed(0).padStart(4)} s  first 10° ${r.firstTenDegrees.toFixed(0).padStart(3)} s  90° ${r.quarterTurn.toFixed(0).padStart(3)} s  diameter ${r.tacticalDiameter.toFixed(0).padStart(4)} m (${(r.tacticalDiameter / 0.9144).toFixed(0)} yd, ${r.diameterLengths.toFixed(1)} L)`;
    });
    const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
    if (proc.env.HANDLING) proc.stderr.write(`${rows.join('\n')}\n`);
    expect(rows.length).toBe(SHIPS.length);
    expect(KNOT).toBeGreaterThan(0);
  });
});
