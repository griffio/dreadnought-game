import { describe, it } from 'vitest';
import { BISMARCK_WOUNDED_SETUP, RODNEY_SETUP } from '../../src/data/ships/fleet';
import { CRIPPLED_CAPTAIN, STEADY_GUNNER } from '../../src/sim/combat/ai';
import { Duel } from '../../src/sim/combat/duel';
import { Rng } from '../../src/sim/rng';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);

describe.skipIf(!proc.env.CAPLOG)('capital log', () => {
  it('prints one fight', () => {
    const seed = Number(proc.env.CAPLOG);
    const rng = new Rng(seed * 977);
    const range = (12 + rng.next() * 2) * 1000;
    const bearing = rng.next() * Math.PI * 2;
    const d = new Duel({
      seed,
      a: { setup: RODNEY_SETUP, ai: { ...STEADY_GUNNER, rangeMin: 9000, rangeMax: 14000 }, x: 0, z: 0, headingDeg: rng.next() * 360 },
      b: { setup: BISMARCK_WOUNDED_SETUP, ai: CRIPPLED_CAPTAIN, x: Math.sin(bearing) * range, z: -Math.cos(bearing) * range, headingDeg: rng.next() * 360 },
      env: { windX: (rng.next() - 0.5) * 12, windZ: (rng.next() - 0.5) * 12, coriolisLatitudeDeg: 52, densityScale: 1 },
    });
    d.run(Number(proc.env.TMAX ?? 400));
    for (const r of d.log) if (r.ship.includes('Rodney') || proc.env.BOTH) say(`${r.ship.slice(0, 6)} [${r.tone}] ${r.text}`);
    say(JSON.stringify(d.a.damage.summary()));
    say(JSON.stringify(d.a.impacts));
    say(JSON.stringify(d.a.byPlate));
    say(`range ${Math.hypot(d.a.x - d.b.x, d.a.z - d.b.z).toFixed(0)}`);
  });
});
