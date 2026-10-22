import { describe, it } from 'vitest';
import { narrowsFortSpecs, narrowsMines, narrowsTerrain, NARROWS_START } from '../../src/data/missions/narrows';
import { DREADNOUGHT_SETUP, QUEEN_ELIZABETH_SETUP } from '../../src/data/ships/fleet';
import { Siege } from '../../src/sim/combat/siege';
import { SiegeBot } from '../../src/sim/combat/siege-bot';
import { paceById } from '../../src/sim/pace';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);

const ROUTE: [number, number][] = [
  [-1250, 3400],
  [-1250, 1800],
  [-150, 1200],
  [200, -300],
  [200, -1500],
  [-300, -2400],
  [-500, -3700],
  [-300, -5200],
  [0, -8000],
];

describe.skipIf(!proc.env.SIEGE)('siege', () => {
  it('runs the narrows', () => {
    const terrain = narrowsTerrain();
    const seeds = Array.from({ length: Number(proc.env.SIEGE) }, (_, i) => i + 1);
    for (const seed of seeds) {
      const t0 = performance.now();
      const s = new Siege({ seed, terrain, setup: proc.env.SHIP === 'dreadnought' ? DREADNOUGHT_SETUP : QUEEN_ELIZABETH_SETUP, start: NARROWS_START, forts: narrowsFortSpecs(), mines: narrowsMines(), pace: paceById(proc.env.PACE) });
      const bot = new SiegeBot(s, ROUTE, proc.env.PLAN === 'run' ? 'run' : 'bombard', proc.env.PLANE !== '0', proc.env.STANDOFF ? Number(proc.env.STANDOFF) : { island: 9500, west: 5200, east: 4200, howitzers: 7000 });
      const silencedAt = new Map<string, number>();
      let next = 0;
      while (s.time < Number(proc.env.TMAX ?? 2400) && !s.silenced && !s.lost) {
        s.step(bot.update(s.time));
        for (const f of s.forts) if (f.silenced && !silencedAt.has(f.name)) silencedAt.set(f.name, s.time);
        if (s.time >= next) {
          next += 120;
          const sm = s.player.damage.summary();
          say(`  t=${s.time.toFixed(0)} pos (${s.dyn.x.toFixed(0)},${s.dyn.z.toFixed(0)}) spd ${(s.dyn.speed / 0.514444).toFixed(0)} hits ${s.player.hitsTaken} flood ${sm.floodedT.toFixed(0)} forts ${s.forts.map((f) => `${f.gunsLeft}/${f.emplacements.length}${f.revealed(s.time) ? '' : '?'}`).join(' ')} plane ${s.plane.state} shells ${s.player.shellsFired}`);
        }
      }
      const sm = s.player.damage.summary();
      say(`seed ${seed}: t=${s.time.toFixed(0)} silenced ${s.silenced} lost ${s.lost} status ${sm.status} hitsTaken ${s.player.hitsTaken} grounded ${s.groundings} mines ${s.mineHits} forts [${s.forts.map((f) => f.gunsLeft).join(',')}] wall ${(performance.now() - t0).toFixed(0)}ms\n  silenced at: ${[...silencedAt].map(([n, t]) => `${n} ${t.toFixed(0)}s`).join(', ')}; fort shells ${s.forts.map((f) => f.shellsFired).join('/')} hits taken by forts ${s.forts.map((f) => f.hitsTaken).join('/')}`);
    }
  }, 900_000);
});
