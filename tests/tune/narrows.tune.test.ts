import { describe, it } from 'vitest';
import { narrowsTerrain } from '../../src/data/missions/narrows';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
describe.skipIf(!proc.env.NARROWS)('narrows', () => {
  it('prints the safe water', () => {
    const t = narrowsTerrain();
    const rows: string[] = [];
    rows.push('       x: -2400 ... 2400 (step 100)');
    for (let z = 7000; z >= -9000; z -= 250) {
      let r = '';
      for (let x = -2400; x <= 2400; x += 100) {
        const d = t.depthAt(x, z);
        const land = t.isLand(x, z);
        r += land ? '#' : d < 9 ? 'x' : d < 15 ? '-' : d < 30 ? '.' : ' ';
      }
      rows.push(`${String(z).padStart(6)} ${r}`);
    }
    proc.stderr.write(rows.join('\n') + '\n');
  });
});
