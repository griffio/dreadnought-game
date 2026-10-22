/** The fires that light a ship's hull: the brightest few. */
export const MAX_FIRES = 8;

export interface FireSite {
  /** Ship space. */
  at: readonly [number, number, number];
  /** 0..1 */
  intensity: number;
}

/** Pack the brightest fires, four numbers each (ship-space position, intensity), into `out`; returns how many. */
export function packFires(sites: readonly FireSite[], out: Float32Array): number {
  const top = sites.length <= MAX_FIRES ? sites : [...sites].sort((a, b) => b.intensity - a.intensity).slice(0, MAX_FIRES);
  out.fill(0);
  top.forEach((f, i) => out.set([f.at[0], f.at[1], f.at[2], Math.min(Math.max(f.intensity, 0), 1)], i * 4));
  return top.length;
}
