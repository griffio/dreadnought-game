import type { Rng } from '../rng';
import type { TorpedoSpec } from './spec';

export type TorpedoDefect = 'none' | 'deep' | 'sinks';

export interface Torpedo {
  id: number;
  shooter: number;
  spec: TorpedoSpec;
  x: number;
  z: number;
  /** Compass heading, radians. */
  heading: number;
  speed: number;
  /** Running depth, metres below the surface. */
  depth: number;
  /** Distance run so far and how far it can run. */
  run: number;
  maxRun: number;
  defect: TorpedoDefect;
  armed: boolean;
  /** The sides that have noticed its track (so a warning is given once each). */
  seenBy: number[];
  /** Ships it has run under without touching. */
  passedUnder: number[];
}

/** A ship as a torpedo target: her outline below the water and how she takes a hit. */
export interface TorpedoTarget {
  id: number;
  alive: boolean;
  x: number;
  z: number;
  /** Compass heading, radians. */
  heading: number;
  halfLength: number;
  /** Half-breadth and keel depth at a ship-space x, metres. */
  halfBreadthAt: (x: number) => number;
  keelAt: (x: number) => number;
  /** She was hit: ship-space x of the strike, the side (+1 starboard), and the torpedo's depth. */
  onTorpedoHit: (hit: { x: number; side: 1 | -1; depth: number; warheadKg: number; cause?: 'mine' }) => void;
}

export interface TorpedoLaunch {
  shooter: number;
  spec: TorpedoSpec;
  x: number;
  z: number;
  heading: number;
  settingIndex: number;
  depth: number;
}

export type TorpedoEvent =
  | { kind: 'launched'; torpedo: Torpedo }
  | { kind: 'hit'; torpedo: Torpedo; targetId: number; x: number; z: number; depth: number }
  | { kind: 'ran-out'; torpedo: Torpedo }
  | { kind: 'sank'; torpedo: Torpedo }
  | { kind: 'passed-under'; torpedo: Torpedo; targetId: number }
  | { kind: 'sighted'; torpedo: Torpedo; by: number; range: number };

/** Something that can notice a torpedo track: a ship on the other side. */
export interface TrackObserver {
  id: number;
  x: number;
  z: number;
}

/**
 * Every torpedo in the water. They run straight at their set speed; the first ship whose underwater outline they enter takes
 * the hit (if they are armed and not running under her keel), and a ship on the other side that comes within sight of the
 * track is told of it once.
 */
export class TorpedoWorld {
  readonly torpedoes: Torpedo[] = [];
  private nextId = 1;
  /** How many have ever been launched. */
  launched = 0;

  constructor(private readonly rng: Rng) {}

  launch(l: TorpedoLaunch): Torpedo {
    const setting = l.spec.settings[Math.min(Math.max(l.settingIndex, 0), l.spec.settings.length - 1)]!;
    const u = this.rng.next();
    const defect: TorpedoDefect = u < l.spec.reliability ? 'none' : u < l.spec.reliability + (1 - l.spec.reliability) * 0.55 ? 'deep' : 'sinks';
    const t: Torpedo = {
      id: this.nextId++,
      shooter: l.shooter,
      spec: l.spec,
      x: l.x,
      z: l.z,
      heading: l.heading,
      speed: setting.speed,
      depth: defect === 'deep' ? l.spec.depthMax + 6 : Math.min(Math.max(l.depth, l.spec.depthMin), l.spec.depthMax),
      run: 0,
      maxRun: defect === 'sinks' ? 250 + this.rng.next() * 500 : setting.range,
      defect,
      armed: false,
      seenBy: [],
      passedUnder: [],
    };
    this.torpedoes.push(t);
    this.launched++;
    return t;
  }

  /**
   * Advance by `dt`. `targets` are the ships that can be hit (the shooter's own is skipped); `observers` the ships that may
   * notice a track within `sightRange` metres.
   */
  step(dt: number, targets: readonly TorpedoTarget[], observers: readonly TrackObserver[], sightRange: number): TorpedoEvent[] {
    const events: TorpedoEvent[] = [];
    let w = 0;
    for (let i = 0; i < this.torpedoes.length; i++) {
      const t = this.torpedoes[i]!;
      const d = t.speed * dt;
      t.x += Math.sin(t.heading) * d;
      t.z -= Math.cos(t.heading) * d;
      t.run += d;
      if (!t.armed && t.run >= t.spec.armingDistance) t.armed = true;

      let gone = false;
      for (const target of targets) {
        if (!target.alive || target.id === t.shooter || !t.armed) continue;
        // Into the ship's own frame: x forward, z to starboard.
        const dx = t.x - target.x;
        const dz = t.z - target.z;
        const sh = Math.sin(target.heading);
        const ch = Math.cos(target.heading);
        const lx = dx * sh - dz * ch;
        const lz = dx * ch + dz * sh;
        if (Math.abs(lx) > target.halfLength) continue;
        if (Math.abs(lz) > target.halfBreadthAt(lx)) continue;
        if (t.depth >= target.keelAt(lx) * 0.97) {
          // Running under her keel: she is not touched, and the torpedo goes on.
          if (!t.passedUnder.includes(target.id)) {
            t.passedUnder.push(target.id);
            events.push({ kind: 'passed-under', torpedo: t, targetId: target.id });
          }
          continue;
        }
        const side: 1 | -1 = lz >= 0 ? 1 : -1;
        target.onTorpedoHit({ x: lx, side, depth: t.depth, warheadKg: t.spec.warheadKg });
        events.push({ kind: 'hit', torpedo: t, targetId: target.id, x: t.x, z: t.z, depth: t.depth });
        gone = true;
        break;
      }
      if (!gone && t.run >= t.maxRun) {
        events.push({ kind: t.defect === 'sinks' ? 'sank' : 'ran-out', torpedo: t });
        gone = true;
      }
      if (!gone) {
        for (const o of observers) {
          if (o.id === t.shooter || t.seenBy.includes(o.id)) continue;
          const range = Math.hypot(o.x - t.x, o.z - t.z);
          if (range <= sightRange) {
            t.seenBy.push(o.id);
            events.push({ kind: 'sighted', torpedo: t, by: o.id, range });
          }
        }
        this.torpedoes[w++] = t;
      }
    }
    this.torpedoes.length = w;
    return events;
  }
}
