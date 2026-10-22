import { describe, it } from 'vitest';
import type { Evasion } from '../../src/sim/combat/player-bot';
import { scenario } from './scenario';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const TUNE = proc.env.TUNE;
const say = (s: string): void => proc.stderr.write(`${s}\n`);

describe.skipIf(!TUNE)('destroyer attack tuning', () => {
  for (const [n, evasion] of [[1, 'none'], [1, 'head-on'], [2, 'none'], [2, 'head-on']] as [number, Evasion][]) {
    it(`${n} destroyer(s) vs ${evasion}`, () => {
      const rows: string[] = [];
      const outcomes: Record<string, number> = {};
      const fate: Record<string, number> = {};
      let hits = 0, launched = 0, bursts = 0, sunkT = 0, destroyersSunk = 0;
      const times: number[] = [];
      const seeds = Array.from({ length: Number(TUNE) || 10 }, (_, i) => i + 1);
      for (const seed of seeds) {
        const t0 = performance.now();
        const b = scenario(seed, n, evasion);
        const o = b.run(Number(proc.env.TMAX ?? 1200));
        outcomes[o] = (outcomes[o] ?? 0) + 1;
        const ev = b.torpedoEvents;
        launched += b.arena.torpedoes.launched;
        for (const e of ev) fate[e.kind] = (fate[e.kind] ?? 0) + 1;
        const h = ev.filter((e) => e.kind === 'hit' && e.targetId === b.player.id).length;
        hits += h;
        bursts += b.player.hitsTaken;
        destroyersSunk += b.enemies.filter((c) => !c.alive).length;
        if (!b.player.alive || ['sinking', 'sunk', 'exploded'].includes(b.player.damage.status)) sunkT++;
        times.push(b.time);
        say(`seed ${seed} (${n} dd, ${evasion}): ${o} wall ${(performance.now() - t0).toFixed(0)} ms`);
        rows.push(`seed ${seed}: ${o} t=${b.time.toFixed(0)} torpHits=${h} shellHits=${b.player.hitsTaken} dd=${b.enemies.map((c) => c.damage.status).join(',')} player=${b.player.damage.status}`);
      }
      say(`\n== ${n} dd vs ${evasion}: outcomes ${JSON.stringify(outcomes)} torpedoHits ${hits} (launched ${launched}; ${JSON.stringify(fate)}) shellHits ${bursts} playerLost ${sunkT} ddSunk ${destroyersSunk}\n${rows.join('\n')}`);
    }, 600_000);
  }
});
