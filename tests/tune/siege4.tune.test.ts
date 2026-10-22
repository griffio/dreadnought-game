import { describe, it } from 'vitest';
import { narrowsFortSpecs, narrowsMines, narrowsTerrain } from '../../src/data/missions/narrows';
import { DREADNOUGHT_SETUP } from '../../src/data/ships/fleet';
import { Siege } from '../../src/sim/combat/siege';
import { MineField } from '../../src/sim/mines/mines';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);
describe.skipIf(!proc.env.DBG4)('dbg4', () => {
  it('sits in the strait and takes it', () => {
    const terrain = narrowsTerrain();
    const only = (proc.env.ONLY ?? '').split(',').filter(Boolean);
    const forts = narrowsFortSpecs().filter((f) => only.length === 0 || only.includes(f.id));
    const z = Number(proc.env.Z ?? -2300);
    const x = Number(proc.env.X ?? 150);
    for (const seed of [1, 2, 3]) {
      const s = new Siege({ seed, terrain, setup: DREADNOUGHT_SETUP, start: { x, z, headingDeg: 0 }, forts, mines: new MineField() });
      s.dyn.setTelegraph(0);
      s.dyn.speed = 0;
      const byFort = new Map<string, number>();
      s.player.onShellEvent = () => {};
      let next = 0;
      while (s.time < Number(proc.env.TMAX ?? 600) && !s.lost) {
        s.step(s.player.batteries.map(() => false));
        if (s.time >= next) {
          next += 100;
          const sm = s.player.damage.summary();
          say(`  seed ${seed} t=${s.time.toFixed(0)} hits ${s.player.hitsTaken} flooded ${sm.floodedT.toFixed(0)} fires ${sm.fires} turretsLost ${sm.turretsLost} power ${sm.power.toFixed(2)} crew ${sm.crew.toFixed(2)} shells ${forts.map((f, i) => `${s.forts[i]!.shellsFired}`).join('/')}`);
        }
      }
      void byFort;
      say(`seed ${seed}: status ${s.player.damage.status} hits ${s.player.hitsTaken} impacts ${JSON.stringify(s.player.impacts)} plates ${JSON.stringify(s.player.byPlate)}`);
    }
  });
});
