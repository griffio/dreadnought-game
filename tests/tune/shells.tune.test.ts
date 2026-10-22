import { describe, it } from 'vitest';
import { narrowsFortSpecs, narrowsMines, narrowsTerrain, NARROWS_START } from '../../src/data/missions/narrows';
import { DESTROYER_SETUP, DREADNOUGHT_SETUP, KAISER_SETUP, PRE_DREADNOUGHT_SETUP, QUEEN_ELIZABETH_SETUP } from '../../src/data/ships/fleet';
import { HIGH_SEAS_FLEET, STEADY_GUNNER } from '../../src/sim/combat/ai';
import { Duel } from '../../src/sim/combat/duel';
import { Siege } from '../../src/sim/combat/siege';
import { SiegeBot } from '../../src/sim/combat/siege-bot';
import type { ShellKind } from '../../src/sim/gunnery/shells';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const say = (s: string): void => proc.stderr.write(`${s}\n`);

/** SHELLS=duel: the same duel with each round in the player's guns, over a number of seeds (SEEDS, default 12). */
describe.skipIf(proc.env.SHELLS !== 'duel')('AP against HE in a duel', () => {
  const foes = { kaiser: [KAISER_SETUP, HIGH_SEAS_FLEET, 9000], hessen: [PRE_DREADNOUGHT_SETUP, undefined, 8000] } as const;
  for (const [foeName, [foeSetup, profile, range]] of Object.entries(foes)) {
    it(`QE v ${foeName}`, { timeout: 1_200_000 }, () => {
      for (const shell of ['ap', 'he'] as ShellKind[]) {
        const rows: string[] = [];
        let won = 0;
        let lost = 0;
        const times: number[] = [];
        let hits = 0;
        let shells = 0;
        for (let i = 0; i < Number(proc.env.SEEDS ?? 12); i++) {
          const duel = new Duel({
            seed: 100 + i * 7,
            a: { setup: QUEEN_ELIZABETH_SETUP, ai: STEADY_GUNNER, x: 0, z: 0, headingDeg: 0, shell },
            b: { setup: foeSetup, ai: profile ?? { ...HIGH_SEAS_FLEET, rangeMin: 6000, rangeMax: 9000 }, x: Math.sin(-0.4) * range, z: -Math.cos(-0.4) * range, headingDeg: 180 },
            visibilityKm: 25,
          });
          const o = duel.run(2400);
          if (o === 'a-won') won++;
          if (o === 'b-won') lost++;
          times.push(duel.time);
          hits += duel.a.hitsScored;
          shells += duel.a.shellsFired;
          rows.push(`${o[0]}${duel.time.toFixed(0)}(${duel.b.damage.status})`);
        }
        times.sort((a, b) => a - b);
        say(`${foeName.padEnd(7)} ${shell}: QE won ${won} lost ${lost} of ${rows.length}, median ${times[Math.floor(times.length / 2)]!.toFixed(0)} s, hits ${hits}/${shells} shells  ${rows.join(' ')}`);
      }
    });
  }
});

/** SHELLS=siege: the Narrows with each round: how fast the forts are silenced. */
describe.skipIf(proc.env.SHELLS !== 'siege')('AP against HE against the forts', () => {
  const ROUTE: [number, number][] = [[-1250, 3400], [-1250, 1800], [-150, 1200], [200, -300], [200, -1500], [-300, -2400], [-500, -3700], [-300, -5200], [0, -8000]];
  it('runs the narrows', { timeout: 1_200_000 }, () => {
    const terrain = narrowsTerrain();
    for (const shell of ['ap', 'he'] as ShellKind[]) {
      for (const setup of [QUEEN_ELIZABETH_SETUP, DREADNOUGHT_SETUP]) {
        const out: string[] = [];
        for (let seed = 1; seed <= Number(proc.env.SEEDS ?? 3); seed++) {
          const s = new Siege({ seed, terrain, setup, start: NARROWS_START, forts: narrowsFortSpecs(), mines: narrowsMines(), shell });
          const bot = new SiegeBot(s, ROUTE, 'bombard', true, { island: 9500, west: 5200, east: 4200, howitzers: 7000 });
          const at = new Map<string, number>();
          while (s.time < 1800 && !s.silenced && !s.lost) {
            s.step(bot.update(s.time));
            for (const f of s.forts) if (f.silenced && !at.has(f.name)) at.set(f.name, s.time);
          }
          out.push(`seed ${seed}: ${[...at].map(([n, t]) => `${n.split(' ')[0]} ${t.toFixed(0)}s`).join(', ') || 'none silenced'}; hits taken ${s.player.hitsTaken}`);
        }
        say(`${setup.name.padEnd(22)} ${shell}: ${out.join(' | ')}`);
      }
    }
  });
});

/** SHELLS=small: the main guns against a torpedo boat, which an armour-piercing shell passes through without bursting. */
describe.skipIf(proc.env.SHELLS !== 'small')('AP against HE against a destroyer', () => {
  it('QE v a destroyer', { timeout: 600_000 }, () => {
    for (const shell of ['ap', 'he'] as ShellKind[]) {
      const times: number[] = [];
      let hits = 0;
      let shells = 0;
      let sunk = 0;
      for (let i = 0; i < Number(proc.env.SEEDS ?? 16); i++) {
        const duel = new Duel({
          seed: 300 + i * 11,
          a: { setup: { ...QUEEN_ELIZABETH_SETUP, autoTarget: undefined }, ai: STEADY_GUNNER, x: 0, z: 0, headingDeg: 0, shell },
          b: { setup: DESTROYER_SETUP, ai: { ...HIGH_SEAS_FLEET, rangeMin: 5000, rangeMax: 8000 }, x: 6500, z: -3000, headingDeg: 270 },
          visibilityKm: 25,
        });
        const o = duel.run(900);
        if (o === 'a-won') sunk++;
        times.push(o === 'a-won' ? duel.time : 900);
        hits += duel.a.hitsScored;
        shells += duel.a.shellsFired;
      }
      times.sort((a, b) => a - b);
      say(`destroyer ${shell}: sunk ${sunk} of ${times.length}, median ${times[Math.floor(times.length / 2)]!.toFixed(0)} s, QE hits ${hits}/${shells}`);
    }
  });
});
