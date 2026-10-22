import type { TorpedoTarget } from '../torpedo/world';

/** A moored contact mine, lying just under the surface. */
export interface Mine {
  id: number;
  x: number;
  z: number;
  /** Depth of the horns below the surface, metres: a ship with a deeper draft strikes it. */
  depth: number;
  /** Seen by an aircraft or a sweeper, so it shows on the chart. */
  revealed: boolean;
  exploded: boolean;
}

/** Bursting charge of a mine, kg: about what a torpedo carries. */
export const MINE_CHARGE_KG = 90;

export interface MineEvent {
  mine: Mine;
  /** The ship that struck it. */
  targetId: number;
}

/**
 * A minefield. The mines are not on the chart until they are spotted (from the air, where the water is clear) or swept; a
 * ship that runs onto one has the hull opened below the belt, as for a torpedo.
 */
export class MineField {
  readonly mines: Mine[] = [];
  private nextId = 1;

  add(x: number, z: number, depth = 2.5): Mine {
    const m: Mine = { id: this.nextId++, x, z, depth, revealed: false, exploded: false };
    this.mines.push(m);
    return m;
  }

  /** A line of mines between two points with a gap (a swept channel) left between `gapFrom` and `gapTo` along it, metres. */
  addLine(x0: number, z0: number, x1: number, z1: number, spacing: number, gap?: readonly [number, number]): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(Math.floor(len / spacing), 1);
    for (let i = 0; i <= n; i++) {
      const d = (i / n) * len;
      if (gap && d >= gap[0] && d <= gap[1]) continue;
      const t = i / n;
      // Moored mines do not lie in a ruled line.
      const jitter = ((i * 7919) % 13) - 6;
      this.add(x0 + (x1 - x0) * t + jitter, z0 + (z1 - z0) * t + jitter * 0.7);
    }
  }

  /** Mark every mine within `radius` of a point as seen. Returns how many were newly revealed. */
  reveal(x: number, z: number, radius: number): number {
    let n = 0;
    for (const m of this.mines) {
      if (m.revealed || m.exploded) continue;
      if (Math.hypot(m.x - x, m.z - z) <= radius) {
        m.revealed = true;
        n++;
      }
    }
    return n;
  }

  /** Test the ships' underwater outlines against the mines. A mine that is struck goes off. */
  step(targets: readonly TorpedoTarget[]): MineEvent[] {
    const events: MineEvent[] = [];
    for (const m of this.mines) {
      if (m.exploded) continue;
      for (const t of targets) {
        if (!t.alive) continue;
        const dx = m.x - t.x;
        const dz = m.z - t.z;
        if (Math.abs(dx) > t.halfLength + 10 || Math.abs(dz) > t.halfLength + 10) continue;
        const sh = Math.sin(t.heading);
        const ch = Math.cos(t.heading);
        const lx = dx * sh - dz * ch;
        const lz = dx * ch + dz * sh;
        if (Math.abs(lx) > t.halfLength) continue;
        // The horns reach a couple of metres to either side of the mine's body.
        if (Math.abs(lz) > t.halfBreadthAt(lx) + 1.5) continue;
        if (m.depth >= t.keelAt(lx)) continue;
        m.exploded = true;
        m.revealed = true;
        t.onTorpedoHit({ x: lx, side: lz >= 0 ? 1 : -1, depth: Math.max(m.depth + 2, 3), warheadKg: MINE_CHARGE_KG, cause: 'mine' });
        events.push({ mine: m, targetId: t.id });
        break;
      }
    }
    return events;
  }
}
