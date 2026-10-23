// Build-only plugin: after Vite has written dist/, take the asset tools' working folders out of it (they live under public/, git-ignored,
// and must not ship: review pages, candidates, smoke tests) and stamp the service worker with the build, so that a new build throws
// the old cache away.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NOT_SHIPPED = ['smoke', 'sfx-review', 'voice-review', 'whistle-review'];

export default function finishBuild(out = 'dist') {
  return {
    name: 'finish-build',
    apply: 'build',
    closeBundle() {
      for (const dir of NOT_SHIPPED) rmSync(join(out, dir), { recursive: true, force: true });
      const sw = join(out, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', new Date().toISOString().replace(/[:.]/g, '-')));
    },
  };
}
