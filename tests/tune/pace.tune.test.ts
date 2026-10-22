import { describe, it } from 'vitest';
import { KAISER_SETUP } from '../../src/data/ships/fleet';
import { HIGH_SEAS_FLEET, STEADY_GUNNER } from '../../src/sim/combat/ai';
import { Duel } from '../../src/sim/combat/duel';
import { QUEEN_ELIZABETH, } from '../../src/data/ships/queen-elizabeth';
import { QUEEN_ELIZABETH_SETUP } from '../../src/data/ships/fleet';
import { CALM } from '../../src/sim/gunnery/ballistics';
import { Gunnery, REAL_PLOT, type Contact, type PlotTiming } from '../../src/sim/gunnery/gunnery';
import { mountsFromSpec } from '../../src/sim/gunnery/mounts';
import { ARCADE, pacedProfile, pacedSetup, REAL, type Pace } from '../../src/sim/pace';
import { Rng } from '../../src/sim/rng';
import type { ShipFrame } from '../../src/sim/ships/frame';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const KNOT = 0.514444;

/**
 * PACE=1: how long the plotting table takes to find a steady target's course and speed, at the real pace and the arcade one,
 * and how far its answer is from the truth when it calls itself settled.
 */
describe.skipIf(!proc.env.PACE)('plot settle time', () => {
  const mounts = mountsFromSpec(QUEEN_ELIZABETH).filter((m) => ['A', 'B', 'X', 'Y'].includes(m.id));
  const ship: ShipFrame = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0 };

  const run = (setup: typeof QUEEN_ELIZABETH_SETUP, rangeM: number, seed: number) => {
    const gun = setup.batteries[0]!.gun;
    const g = new Gunnery({ gun, mounts, rng: new Rng(seed), shooterId: 1, env: CALM, rangefinder: setup.rangefinder, visibilityKm: 30, directorHeight: 29, solvePeriod: 0.5, plot: setup.plot });
    const target: Contact = { id: 2, name: 'T', x: rangeM, z: 0, vx: 0, vz: -14 * KNOT * 1.1, heading: 0, halfLength: 85, halfBeam: 13, draft: 8, height: 20, topHeight: 40, deckHeight: 8 };
    g.contacts.push(target);
    g.designate(target);
    let settledAt: number | null = null;
    let goodAt: number | null = null;
    for (let t = 0, now = 0; t < 120 * 60; t++) {
      now = t / 60;
      target.x += target.vx / 60;
      target.z += target.vz / 60;
      g.update(1 / 60, now, ship, false);
      if (t % 30 !== 0) continue;
      const s = g.status(ship);
      const est = s.estimate;
      if (proc.env.PACE === 'trace' && seed === 11 && setup.plot) proc.stderr.write(`t=${now.toFixed(0)} ${s.quality} est=${est ? est.speedKn.toFixed(1) : '-'}\n`);
      if (settledAt === null && s.quality === 'settled') settledAt = now;
      if (goodAt === null && est) {
        const truth = Math.hypot(target.vx, target.vz);
        const err = Math.hypot(Math.sin((est.courseDeg * Math.PI) / 180) * est.speedKn * KNOT - target.vx, -Math.cos((est.courseDeg * Math.PI) / 180) * est.speedKn * KNOT - target.vz);
        if (err < 0.08 * truth + 0.3) goodAt = now;
      }
    }
    return { settledAt, goodAt };
  };

  it('prints time to settle and time to a good velocity', () => {
    const rows: string[] = [];
    const variants: [string, typeof QUEEN_ELIZABETH_SETUP][] = [
      ['real', pacedSetup(QUEEN_ELIZABETH_SETUP, REAL)],
      ['arcade', pacedSetup(QUEEN_ELIZABETH_SETUP, ARCADE)],
    ];
    for (const km of [4, 6, 9]) {
      for (const [name, setup] of variants) {
        const rs = Array.from({ length: 12 }, (_, i) => run(setup, km * 1000, 11 + i));
        const med = (xs: (number | null)[]) => {
          const v = xs.map((x) => x ?? 120).sort((a, b) => a - b);
          return v[Math.floor(v.length / 2)]!.toFixed(0);
        };
        rows.push(`${String(km).padStart(2)} km ${name.padEnd(7)} settled@${med(rs.map((r) => r.settledAt))}s  good@${med(rs.map((r) => r.goodAt))}s`);
      }
    }
    proc.stderr.write(rows.join('\n') + '\n');
  });
});

/** PACE=duel: QE against Kaiser at each pace, over a dozen seeds: how long it lasts, who wins, and how the shooting goes. */
describe.skipIf(proc.env.PACE !== 'duel')('arcade duel', () => {
  const fight = (pace: Pace, seed: number, rangeM: number) => {
    const duel = new Duel({
      seed,
      a: { setup: pacedSetup(QUEEN_ELIZABETH_SETUP, pace), ai: pacedProfile(STEADY_GUNNER, pace), x: 0, z: 0, headingDeg: 0 },
      b: { setup: pacedSetup(KAISER_SETUP, pace), ai: pacedProfile(HIGH_SEAS_FLEET, pace), x: Math.sin(-25 * Math.PI / 180) * rangeM, z: -Math.cos(-25 * Math.PI / 180) * rangeM, headingDeg: 180 },
      visibilityKm: 25,
    });
    const outcome = duel.run(2400);
    return { outcome, time: duel.time, aHits: duel.a.hitsScored, aShells: duel.a.shellsFired, bHits: duel.b.hitsScored, bShells: duel.b.shellsFired, aCond: duel.a.damage.status, bCond: duel.b.damage.status };
  };
  it('prints the fights', { timeout: 1_200_000 }, () => {
    const rows: string[] = [];
    const variants: [Pace, number][] = [[REAL, 15000]];
    for (const e of (proc.env.ENGAGE ?? '0.55,0.7,0.85').split(',').map(Number)) variants.push([{ ...ARCADE, id: 'arcade', name: `arcade@${e}`, engagement: e }, 11000 * e]);
    for (const [pace, range] of variants) {
      const fights = Array.from({ length: Number(proc.env.SEEDS ?? 12) }, (_, i) => fight(pace, 100 + i * 7, range));
      const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const tally = (o: string) => fights.filter((f) => f.outcome === o).length;
      rows.push(`${pace.name.padEnd(12)} QE won ${tally('a-won')}  Kaiser won ${tally('b-won')}  draw ${tally('draw')}  median ${med(fights.map((f) => f.time)).toFixed(0)}s  QE hits ${med(fights.map((f) => f.aHits))}/${med(fights.map((f) => f.aShells))}  Kaiser hits ${med(fights.map((f) => f.bHits))}/${med(fights.map((f) => f.bShells))}`);
      rows.push('   ' + fights.map((f) => `${f.outcome[0]}${f.time.toFixed(0)}(${f.bCond})`).join(' '));
    }
    proc.stderr.write(rows.join('\n') + '\n');
  });
});

export type { PlotTiming };
export { REAL_PLOT };
