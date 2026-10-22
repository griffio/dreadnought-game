import { describe, it } from 'vitest';
import { narrowsFortSpecs, narrowsMines, narrowsTerrain } from '../../src/data/missions/narrows';
import { DREADNOUGHT_SETUP } from '../../src/data/ships/fleet';
import { Siege } from '../../src/sim/combat/siege';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);
describe.skipIf(!proc.env.PROF)('prof', () => {
  it('times the parts of a step', () => {
    const terrain = narrowsTerrain();
    const s = new Siege({ seed: 1, terrain, setup: DREADNOUGHT_SETUP, start: { x: 0, z: 4500, headingDeg: 0 }, forts: narrowsFortSpecs(), mines: narrowsMines() });
    s.dyn.setTelegraph(0);
    s.dyn.speed = 0;
    s.player.main.designate(s.forts[0]!);
    s.player.main.autoSpot = true;
    const t = { player: 0, forts: [0, 0, 0, 0], other: 0 };
    const trig = s.player.batteries.map((_, i) => i === 0);
    // Warm up, then time.
    for (let i = 0; i < 60 * 60; i++) s.step(trig);
    const n = 60 * 120;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      s.player.step(1 / 60, s.time + 1 / 60, trig);
      t.player += performance.now() - a;
      s.forts.forEach((f, k) => {
        const b = performance.now();
        f.step(1 / 60, s.time);
        t.forts[k]! += performance.now() - b;
      });
      s.time += 1 / 60;
    }
    const total = performance.now() - t0;
    say(`per step: total ${(total / n).toFixed(3)} ms; player ${(t.player / n).toFixed(3)}; forts ${t.forts.map((x) => (x / n).toFixed(3)).join(' / ')}; shells in flight ${s.player.main.world.shells.length}`);
  });
});
