import { describe, it } from 'vitest';
import {
  BISMARCK_SETUP,
  BISMARCK_WOUNDED_SETUP,
  KAISER_SETUP,
  KING_GEORGE_V_SETUP,
  QUEEN_ELIZABETH_SETUP,
  RODNEY_SETUP,
} from '../../src/data/ships/fleet';
import { BISMARCK_CAPTAIN, CRIPPLED_CAPTAIN, HIGH_SEAS_FLEET, STEADY_GUNNER, type AiProfile } from '../../src/sim/combat/ai';
import { TELEGRAPH } from '../../src/sim/ships/dynamics';
import { Duel } from '../../src/sim/combat/duel';
import type { ShipSetup } from '../../src/sim/combat/setup';
import { Rng } from '../../src/sim/rng';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);

const END = new Set(['struck', 'sinking', 'sunk', 'exploded']);

interface Matchup {
  name: string;
  a: ShipSetup;
  b: ShipSetup;
  aAi: AiProfile;
  bAi: AiProfile;
  rangeKm: [number, number];
  tmax: number;
}

/** A player who keeps moving: full ahead, a change of course now and then. */
const agile = (min: number, max: number): AiProfile => ({ ...STEADY_GUNNER, rangeMin: min, rangeMax: max, engageTelegraph: TELEGRAPH.FULL_AHEAD, jinkDeg: 8, jinkPeriod: 70 });

const MATCHUPS: Record<string, Matchup> = {
  kaiser: {
    name: 'QE vs Kaiser',
    a: QUEEN_ELIZABETH_SETUP,
    b: KAISER_SETUP,
    aAi: proc.env.AGILE ? agile(10000, 14000) : { ...STEADY_GUNNER, rangeMin: 10000, rangeMax: 14000 },
    bAi: HIGH_SEAS_FLEET,
    rangeKm: [15, 18],
    tmax: 2400,
  },
  bismarck: {
    name: 'KGV vs Bismarck',
    a: KING_GEORGE_V_SETUP,
    b: BISMARCK_SETUP,
    aAi: proc.env.AGILE ? agile(13000, 17000) : { ...STEADY_GUNNER, rangeMin: 13000, rangeMax: 17000 },
    bAi: BISMARCK_CAPTAIN,
    rangeKm: [19, 22],
    tmax: 2400,
  },
  last: {
    name: 'Rodney vs wounded Bismarck',
    a: RODNEY_SETUP,
    b: BISMARCK_WOUNDED_SETUP,
    aAi: { ...STEADY_GUNNER, rangeMin: 9000, rangeMax: 14000 },
    bAi: CRIPPLED_CAPTAIN,
    rangeKm: [12, 14],
    tmax: 2400,
  },
};

describe.skipIf(!proc.env.CAPITAL)('capital ship duels', () => {
  it('runs the matchups', () => {
    const which = (proc.env.MATCH ?? 'kaiser').split(',');
    const n = Number(proc.env.CAPITAL);
    for (const key of which) {
      const m = MATCHUPS[key]!;
      const rows: string[] = [];
      let wins = 0;
      let losses = 0;
      const times: number[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const rng = new Rng(seed * 977);
        const range = (m.rangeKm[0] + rng.next() * (m.rangeKm[1] - m.rangeKm[0])) * 1000;
        const bearing = rng.next() * Math.PI * 2;
        const t0 = performance.now();
        const d = new Duel({
          seed,
          a: { setup: m.a, ai: m.aAi, x: 0, z: 0, headingDeg: rng.next() * 360 },
          b: { setup: m.b, ai: m.bAi, x: Math.sin(bearing) * range, z: -Math.cos(bearing) * range, headingDeg: rng.next() * 360 },
          env: { windX: (rng.next() - 0.5) * 12, windZ: (rng.next() - 0.5) * 12, coriolisLatitudeDeg: 52, densityScale: 1 },
        });
        const out = d.run(m.tmax);
        if (out === 'a-won') {
          wins++;
          times.push(d.time);
        }
        if (out === 'b-won') losses++;
        const sa = d.a.damage.summary();
        const sb = d.b.damage.summary();
        rows.push(
          `  seed ${seed}: ${out.padEnd(6)} t=${d.time.toFixed(0).padStart(4)}  A ${d.a.damage.status} hits-taken ${d.a.hitsTaken} turrets-lost ${sa.turretsLost}/${sa.turretsTotal} flood ${sa.floodedT.toFixed(0)}  | B ${d.b.damage.status}${END.has(d.b.damage.status) ? '' : ' (' + d.b.damage.morale.toFixed(2) + ')'} hits-taken ${d.b.hitsTaken} turrets-lost ${sb.turretsLost}/${sb.turretsTotal} flood ${sb.floodedT.toFixed(0)}  shells ${d.a.shellsFired}/${d.b.shellsFired}  [${((performance.now() - t0) / 1000).toFixed(1)}s]`,
        );
        say(rows[rows.length - 1]!);
      }
      times.sort((x, y) => x - y);
      say(`${m.name}: A wins ${wins}/${n}, B wins ${losses}/${n}, median win time ${times.length ? times[Math.floor(times.length / 2)]!.toFixed(0) : '-'} s`);
    }
  }, 3_600_000);
});
