import { describe, it } from 'vitest';
import { BISMARCK_SETUP, DREADNOUGHT_SETUP, KAISER_SETUP, KING_GEORGE_V_SETUP, PRE_DREADNOUGHT_SETUP, QUEEN_ELIZABETH_SETUP, RODNEY_SETUP } from '../../src/data/ships/fleet';
import { penetrationEnvelope } from '../../src/sim/damage/envelope';
import type { ShipSetup } from '../../src/sim/combat/setup';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
const DEG = Math.PI / 180;

const PAIRS: [string, ShipSetup, ShipSetup][] = [
  ['Dreadnought -> Hessen', DREADNOUGHT_SETUP, PRE_DREADNOUGHT_SETUP],
  ['QE -> Kaiser', QUEEN_ELIZABETH_SETUP, KAISER_SETUP],
  ['Kaiser -> QE', KAISER_SETUP, QUEEN_ELIZABETH_SETUP],
  ['KGV -> Bismarck', KING_GEORGE_V_SETUP, BISMARCK_SETUP],
  ['Bismarck -> KGV', BISMARCK_SETUP, KING_GEORGE_V_SETUP],
  ['Rodney -> Bismarck', RODNEY_SETUP, BISMARCK_SETUP],
  ['Bismarck -> Rodney', BISMARCK_SETUP, RODNEY_SETUP],
  ['Kaiser -> Dreadnought', KAISER_SETUP, DREADNOUGHT_SETUP],
];

describe.skipIf(!proc.env.ENV)('penetration envelopes', () => {
  it('prints which ranges get through which plate', () => {
    const lines: string[] = [];
    for (const [name, gun, target] of PAIRS) {
      const g = gun.batteries[0]!.gun;
      const env = penetrationEnvelope(g.shell, g.maxElevationDeg * DEG, 10, target.damage.armor, 2000, 30000, 1000);
      const row = (key: 'belt' | 'upper' | 'deck') => env.bands.map((b) => (b.range > env.reach ? ' ' : b[key] ? '#' : '.')).join('');
      lines.push(`${name.padEnd(22)} reach ${(env.reach / 1000).toFixed(1)} km  (2..30 km, 1 km steps)`);
      lines.push(`   belt  ${row('belt')}   (${target.damage.armor.belt.mm} mm)`);
      lines.push(`   upper ${row('upper')}   (${target.damage.armor.upperSide.mm} mm)`);
      lines.push(`   deck  ${row('deck')}   (${target.damage.armor.deck.mm} mm)`);
    }
    proc.stderr.write(lines.join('\n') + '\n');
  });
});
