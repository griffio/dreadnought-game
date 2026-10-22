import { describe, it } from 'vitest';
import { narrowsFortSpecs, narrowsTerrain } from '../../src/data/missions/narrows';
import { DREADNOUGHT_SETUP } from '../../src/data/ships/fleet';
import { Siege } from '../../src/sim/combat/siege';
import { MineField } from '../../src/sim/mines/mines';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);
describe.skipIf(!proc.env.DBG)('dbg', () => {
  it('prints reports', () => {
    const terrain = narrowsTerrain();
    const id = proc.env.FORT ?? 'west';
    const forts = narrowsFortSpecs().filter((f) => f.id === id);
    const x = Number(proc.env.X ?? -572);
    const z = Number(proc.env.Z ?? 1510);
    const s = new Siege({ seed: 1, terrain, setup: DREADNOUGHT_SETUP, start: { x, z, headingDeg: 90 }, forts, mines: new MineField() });
    s.dyn.setTelegraph(0);
    s.dyn.speed = 0;
    const fort = s.forts[0]!;
    const g = s.player.main;
    g.designate(fort);
    g.autoSpot = true;
    let grounds = 0;
    let hits = 0;
    s.player.main.onReport = (r) => say(`t=${s.time.toFixed(0)} REPORT ${r.text} (${r.shells.length} shells) range corr ${g.corrections.range.toFixed(0)}`);
    s.player.onShellEvent = (e) => {
      if (e.kind === 'ground' && grounds++ < 12) say(`  ground ${e.x.toFixed(0)},${e.z.toFixed(0)} y=${e.y.toFixed(0)} ang ${e.angleDeg.toFixed(1)}`);
      if (e.kind === 'hit') hits++;
    };
    let next = 0;
    while (s.time < Number(proc.env.TMAX ?? 600)) {
      const st = g.status(s.player.cfg.frame());
      const fire = !!st.target && g.canReach && g.track.count >= 6;
      s.step(s.player.batteries.map((_, i) => i === 0 && fire));
      if (s.time >= next) {
        next += 60;
        say(`t=${s.time.toFixed(0)} range ${st.target?.range.toFixed(0)} vis ${st.target?.visible} q ${st.quality} sol ${st.solution ? `el ${(st.solution.elevation * 57.3).toFixed(2)} range ${st.solution.range.toFixed(0)} tof ${st.solution.tof.toFixed(1)}` : '-'} shells ${s.player.shellsFired} hits ${hits} fortHits ${fort.hitsTaken} guns ${fort.gunsLeft} supp ${fort.suppression.toFixed(2)}`);
      }
    }
    say(`fort ground ${fort.base.toFixed(0)} aim ${fort.aimX.toFixed(0)},${fort.aimZ.toFixed(0)}; from ship to fort chord: blocked=${terrain.blocked(x, 26, z, fort.aimX, fort.base + 5, fort.aimZ)}`);
  });
});
