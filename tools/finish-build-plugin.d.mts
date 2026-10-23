import type { Plugin } from 'vite';
/** The folders under public/ that a build removes from its output. */
export const NOT_SHIPPED: readonly string[];
/** After a build: remove the asset tools' working folders from `out` and stamp dist/sw.js with the build. */
export default function finishBuild(out?: string): Plugin;
