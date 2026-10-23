import { launch, stepShell, type Environment, type ShellSpec, type ShellState } from './ballistics';
import type { Terrain } from '../terrain/terrain';
import type { MuzzleShot } from './battery';

/** A ship's hit volume: an oriented box standing on the waterline, extending `draft` below it and `height` above. */
export interface HitBox {
  id: number;
  /** Centre in the horizontal plane, world metres. */
  x: number;
  z: number;
  /** Compass heading, radians. */
  heading: number;
  halfLength: number;
  halfBeam: number;
  draft: number;
  height: number;
  /**
   * Fine resolution of a hit on the box: trace the shell through the ship's armour and decide what happened. Without it a
   * shell reaching the box is simply a hit. Returning null means it found nothing and flies on.
   */
  resolve?: (info: ImpactInfo) => ImpactResolution | null;
  /** A shell that fell close by: does it carry on under the water into the hull? */
  resolveDive?: (info: DiveInfo) => ImpactResolution | null;
}

export interface LiveShell {
  id: number;
  salvo: number;
  shooter: number;
  spec: ShellSpec;
  state: ShellState;
  /** Ships this shell has already gone clean through: it cannot hit them again. */
  passed: number[];
  /** Where it was at the start of the last step: a frame drawn between steps shows it part of the way from here (see `shellAt`). */
  prevX: number;
  prevY: number;
  prevZ: number;
}

/**
 * Where a shell is to be drawn `alpha` (0..1) of the way through the step it last took. The simulation moves in fixed steps and the
 * picture is drawn between them, like the ships; without this a shell, and a camera riding it, would jump once a step, and three
 * frames apart when the shell camera slows the game.
 */
export function shellAt(shell: LiveShell, alpha: number, out: { x: number; y: number; z: number }): void {
  const s = shell.state;
  out.x = shell.prevX + (s.x - shell.prevX) * alpha;
  out.y = shell.prevY + (s.y - shell.prevY) * alpha;
  out.z = shell.prevZ + (s.z - shell.prevZ) * alpha;
}

type V3 = [number, number, number];

/** A shell reaching a ship's hit box: the step it moved, and how fast it is going. */
export interface ImpactInfo {
  shell: LiveShell;
  from: V3;
  to: V3;
  velocity: V3;
}

/** A shell that fell in the sea close to a ship and may carry on under the water. */
export interface DiveInfo {
  shell: LiveShell;
  /** Where it entered the water, world metres. */
  x: number;
  z: number;
  velocity: V3;
  speed: number;
  /** Angle below the horizontal at the surface, degrees. */
  angleDeg: number;
}

/** What the ship the shell reached made of it. */
export interface ImpactResolution {
  kind: 'burst' | 'ricochet' | 'shatter' | 'pass';
  /** Where it burst, glanced off or came out, world metres. */
  at: V3;
  /** False for a shell that went clean through and flies on, at `speed`. */
  consumed: boolean;
  speed: number;
}

export interface SplashEvent {
  kind: 'splash';
  shell: LiveShell;
  x: number;
  z: number;
  /** Speed at the surface, m/s, and the angle below the horizontal, degrees. */
  speed: number;
  angleDeg: number;
  /** The shell ran on under the water and struck this ship's hull below the belt. */
  diveHit?: { targetId: number; outcome: ImpactResolution };
}

export interface HitEvent {
  kind: 'hit';
  shell: LiveShell;
  targetId: number;
  /** World position and the position in the target's own frame (+x bow, +y up, +z starboard). */
  x: number;
  y: number;
  z: number;
  localX: number;
  localY: number;
  localZ: number;
  speed: number;
  angleDeg: number;
  /** How the ship's armour treated it, when the ship resolves hits finely. */
  outcome: ImpactResolution | null;
}

/** A shell that struck the land: where, how fast, and at what angle to the horizontal. */
export interface GroundEvent {
  kind: 'ground';
  shell: LiveShell;
  x: number;
  y: number;
  z: number;
  speed: number;
  angleDeg: number;
}

export type ShellEvent = SplashEvent | HitEvent | GroundEvent;

/** Shells that never come down (or leave the playable area) are dropped after this long, seconds. */
const MAX_FLIGHT_SECONDS = 160;

/**
 * Every shell in the air. Each step moves them with the ballistic integrator, tests the path against the ships' hit
 * boxes, and reports where they land in the sea.
 */
export class ShellWorld {
  readonly shells: LiveShell[] = [];
  /** The land the shells can strike; none for a fight on open water. */
  terrain: Terrain | null = null;
  private nextId = 1;

  constructor(public env: Environment) {}

  spawn(shot: MuzzleShot, spec: ShellSpec, shooter: number): LiveShell {
    const shell: LiveShell = {
      id: this.nextId++,
      salvo: shot.salvo,
      shooter,
      spec,
      state: launch(spec, shot.muzzle, shot.azimuth, shot.elevation, [shot.shipVx, shot.shipVz], shot.velocityScale),
      passed: [],
      prevX: shot.muzzle[0],
      prevY: shot.muzzle[1],
      prevZ: shot.muzzle[2],
    };
    this.shells.push(shell);
    return shell;
  }

  clear(): void {
    this.shells.length = 0;
  }

  step(dt: number, boxes: readonly HitBox[]): ShellEvent[] {
    const events: ShellEvent[] = [];
    let w = 0;
    for (let i = 0; i < this.shells.length; i++) {
      const shell = this.shells[i]!;
      const s = shell.state;
      const px = s.x;
      const py = s.y;
      const pz = s.z;
      shell.prevX = px;
      shell.prevY = py;
      shell.prevZ = pz;
      stepShell(s, shell.spec, this.env, dt);

      let consumed = false;
      // A ship can be struck directly only above the water: the part of this step below the surface is the sea's, and a shell that
      // goes in near a ship reaches her hull, if it does, through the dive below (slowed and turned by the water), not by flying on
      // through it as if it were air.
      let ex = s.x;
      let ey = s.y;
      let ez = s.z;
      if (py > 0 && s.y < 0) {
        const f = py / (py - s.y);
        ex = px + (s.x - px) * f;
        ey = 0;
        ez = pz + (s.z - pz) * f;
      }
      for (const box of boxes) {
        if (box.id === shell.shooter || shell.passed.includes(box.id)) continue;
        const hit = segmentHitsBox(px, py, pz, ex, ey, ez, box);
        if (!hit) continue;
        const speed = Math.hypot(s.vx, s.vy, s.vz);
        const angleDeg = (Math.atan2(-s.vy, Math.hypot(s.vx, s.vz)) * 180) / Math.PI;
        let outcome: ImpactResolution | null = null;
        if (box.resolve) {
          outcome = box.resolve({ shell, from: [px, py, pz], to: [ex, ey, ez], velocity: [s.vx, s.vy, s.vz] });
          // Nothing on its path inside the box: it flies on.
          if (!outcome) continue;
        }
        const at: V3 = outcome ? outcome.at : [hit.x, hit.y, hit.z];
        events.push({
          kind: 'hit',
          shell,
          targetId: box.id,
          x: at[0],
          y: at[1],
          z: at[2],
          localX: hit.lx,
          localY: hit.y,
          localZ: hit.lz,
          speed,
          angleDeg,
          outcome,
        });
        if (outcome && !outcome.consumed) {
          // Through and out: it carries on from where it came out, slower.
          const k = outcome.speed / Math.max(speed, 1);
          s.x = at[0];
          s.y = at[1];
          s.z = at[2];
          s.vx *= k;
          s.vy *= k;
          s.vz *= k;
          shell.passed.push(box.id);
        } else {
          consumed = true;
        }
        break;
      }
      if (!consumed && this.terrain) {
        const ground = this.terrain.segmentHit(px, py, pz, s.x, s.y, s.z);
        if (ground) {
          const speed = Math.hypot(s.vx, s.vy, s.vz);
          const angleDeg = (Math.atan2(-s.vy, Math.hypot(s.vx, s.vz)) * 180) / Math.PI;
          events.push({ kind: 'ground', shell, x: ground.x, y: ground.y, z: ground.z, speed, angleDeg });
          consumed = true;
        }
      }
      if (!consumed && s.y <= 0 && py > 0) {
        const f = py / (py - s.y);
        const x = px + (s.x - px) * f;
        const z = pz + (s.z - pz) * f;
        const speed = Math.hypot(s.vx, s.vy, s.vz);
        const angleDeg = (Math.atan2(-s.vy, Math.hypot(s.vx, s.vz)) * 180) / Math.PI;
        const splash: SplashEvent = { kind: 'splash', shell, x, z, speed, angleDeg };
        // A shell that falls close to a ship may keep going under the water and strike below the belt.
        for (const box of boxes) {
          if (!box.resolveDive || box.id === shell.shooter || shell.passed.includes(box.id)) continue;
          if (Math.hypot(x - box.x, z - box.z) > box.halfLength + 120) continue;
          const outcome = box.resolveDive({ shell, x, z, velocity: [s.vx, s.vy, s.vz], speed, angleDeg });
          if (outcome && outcome.consumed) {
            splash.diveHit = { targetId: box.id, outcome };
            break;
          }
        }
        events.push(splash);
        consumed = true;
      }
      if (!consumed && s.t > MAX_FLIGHT_SECONDS) consumed = true;
      if (!consumed) this.shells[w++] = shell;
    }
    this.shells.length = w;
    return events;
  }
}

/**
 * Where the segment (p0 -> p1) first enters the box, in world and box-local coordinates, or null. Slab method in the
 * box's frame, so a fast shell cannot tunnel through a ship however long its step.
 */
export function segmentHitsBox(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  box: HitBox,
): { x: number; y: number; z: number; lx: number; lz: number } | null {
  // Most steps of most shells are nowhere near the box: a step whose midpoint is farther from the box's centre than the box's
  // reach plus half the step's own length cannot touch it. (This test runs for every shell against every ship, every tick.)
  const ax = x0 - box.x;
  const az = z0 - box.z;
  const bx = x1 - box.x;
  const bz = z1 - box.z;
  const mx = (ax + bx) * 0.5;
  const mz = (az + bz) * 0.5;
  const reach = Math.hypot(box.halfLength, box.halfBeam) + 0.5 * Math.hypot(x1 - x0, z1 - z0);
  if (mx * mx + mz * mz > reach * reach) return null;

  const fx = Math.sin(box.heading);
  const fz = -Math.cos(box.heading);
  const rx = Math.cos(box.heading);
  const rz = Math.sin(box.heading);
  const l0x = ax * fx + az * fz;
  const l0z = ax * rx + az * rz;
  const l1x = bx * fx + bz * fz;
  const l1z = bx * rx + bz * rz;

  let tMin = 0;
  let tMax = 1;
  // Slab test along each of the box's axes, written out so that nothing is allocated.
  for (let k = 0; k < 3; k++) {
    const a = k === 0 ? l0x : k === 1 ? y0 : l0z;
    const b = k === 0 ? l1x : k === 1 ? y1 : l1z;
    const lo = k === 0 ? -box.halfLength : k === 1 ? -box.draft : -box.halfBeam;
    const hi = k === 0 ? box.halfLength : k === 1 ? box.height : box.halfBeam;
    const d = b - a;
    if (Math.abs(d) < 1e-12) {
      if (a < lo || a > hi) return null;
    } else {
      let t1 = (lo - a) / d;
      let t2 = (hi - a) / d;
      if (t1 > t2) {
        const s = t1;
        t1 = t2;
        t2 = s;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }
  }
  return {
    x: x0 + (x1 - x0) * tMin,
    y: y0 + (y1 - y0) * tMin,
    z: z0 + (z1 - z0) * tMin,
    lx: l0x + (l1x - l0x) * tMin,
    lz: l0z + (l1z - l0z) * tMin,
  };
}
