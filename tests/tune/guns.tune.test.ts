import { describe, it } from 'vitest';
import { rangeAtElevation } from '../../src/sim/gunnery/ballistics';
import * as G from '../../src/sim/gunnery/guns';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
describe.skipIf(!proc.env.GUNS)('gun ranges', () => {
  it('prints range at 15/20/30 degrees and the maximum', () => {
    const rows: string[] = [];
    for (const [name, gun] of Object.entries(G)) {
      if (!(gun as { shell?: unknown }).shell || (gun as { highAngle?: boolean }).highAngle) continue;
      const g = gun as G.GunSpec;
      const at = (deg: number) => {
        const r = rangeAtElevation(g.shell, (deg * Math.PI) / 180, 14);
        return r ? (r.range / 1000).toFixed(1) : '-';
      };
      rows.push(`${name.padEnd(20)} ${g.label.padEnd(24)} max ${g.maxElevationDeg}° -> ${at(g.maxElevationDeg)} km   15°: ${at(15)}   30°: ${at(30)}   v ${g.shell.muzzleVelocity} m ${g.shell.massKg} form ${g.shell.formFactor}`);
    }
    proc.stderr.write(rows.join('\n') + '\n');
  });
});
