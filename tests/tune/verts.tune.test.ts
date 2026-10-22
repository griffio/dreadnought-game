import { describe, it } from 'vitest';
import { ROSTER } from '../../src/data/ships/roster';
import { buildShip } from '../../src/render/ships/forge/build-ship';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;

describe.skipIf(!proc.env.VERTS)('model sizes', () => {
  it('prints vertex and triangle counts', () => {
    const rows = Object.values(ROSTER).map((e) => {
      const m = buildShip(e.spec);
      return `${e.id.padEnd(18)} ${String(m.vertexCount).padStart(7)} verts ${String(m.indices.length / 3).padStart(7)} tris  ${m.turrets.length} turrets`;
    });
    proc.stderr.write(rows.join('\n') + '\n');
  });
});
