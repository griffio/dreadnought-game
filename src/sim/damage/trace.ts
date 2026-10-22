import type { HitGeometry, Plate, V3, Zone } from './geometry';
import { FUZE_DELAY_SECONDS, FUZE_TRIGGER_MM, IMPACT_TRIGGER_MM, IMPACT_DELAY_SECONDS, throughPlate } from './penetration';

export interface TraceShell {
  massKg: number;
  diameterMm: number;
  /** Impact-fuzed shells burst on the first solid structure instead of going through it. */
  impact?: boolean;
  /** Speed on arrival, m/s. */
  speed: number;
}

export interface TraceRay {
  /** Where the shell was at the start of the step, ship space. */
  origin: V3;
  /** Unit direction of travel, ship space. */
  dir: V3;
  /** How far the shell moved in the step, metres: the first plate it meets must lie within this to count as a hit now. */
  segment: number;
}

export type TraceKind = 'burst' | 'ricochet' | 'shatter' | 'pass';

export interface TraceResult {
  kind: TraceKind;
  /** The first plate struck, where, and how squarely (1 is square on). */
  first: Plate;
  entry: V3;
  cosTheta: number;
  /** Where it burst (burst), glanced off or broke up (ricochet, shatter) or came out (pass). */
  at: V3;
  /** Speed there, m/s. */
  speed: number;
  /** The zone it burst in, if it burst in one. */
  zone: Zone | null;
  /** Plates it went through on the way, in order (does not include a plate that stopped it). */
  crossed: Plate[];
  stoppedBy?: Plate;
  /** True when it got through a barbette's armour on the way to its burst. */
  barbettePenetrated: boolean;
}

interface Crossing {
  t: number;
  plate: Plate;
  cos: number;
}

/** How far past this step's end the path is followed, for the fuze to run and the shell to reach its burst. */
const EXTENSION = 90;

function crossings(plates: readonly Plate[], o: V3, d: V3, maxT: number, out: Crossing[]): void {
  for (const plate of plates) {
    const axis = plate.axis;
    const da = d[axis];
    if (Math.abs(da) < 1e-9) continue;
    const t = (plate.coord - o[axis]) / da;
    if (t <= 1e-6 || t > maxT) continue;
    const i0 = axis === 0 ? 1 : 0;
    const i1 = axis === 2 ? 1 : 2;
    const p0 = o[i0] + d[i0] * t;
    const p1 = o[i1] + d[i1] * t;
    if (p0 < plate.lo[0] || p0 > plate.hi[0] || p1 < plate.lo[1] || p1 > plate.hi[1]) continue;
    out.push({ t, plate, cos: Math.abs(da) });
  }
}

/** A point or direction into a turret's own frame (its axis at the origin, +x along the guns) for training `train` radians. */
function toTurret(x: number, z: number, train: number): [number, number] {
  const c = Math.cos(train);
  const s = Math.sin(train);
  return [x * c + z * s, -x * s + z * c];
}

const inBox = (p: V3, z: Zone): boolean =>
  p[0] >= z.min[0] && p[0] <= z.max[0] && p[1] >= z.min[1] && p[1] <= z.max[1] && p[2] >= z.min[2] && p[2] <= z.max[2];

/** The highest-priority zone containing a ship-space point, or null if it is in open air. */
export function zoneAt(geom: HitGeometry, p: V3, trainOf: (turretId: string) => number): Zone | null {
  let best: Zone | null = null;
  for (const t of geom.turrets) {
    const [lx, lz] = toTurret(p[0] - t.axisX, p[2] - t.axisZ, trainOf(t.id));
    if (inBox([lx, p[1], lz], t.zone) && (best === null || t.zone.priority > best.priority)) best = t.zone;
  }
  for (const z of geom.zones) {
    if (inBox(p, z) && (best === null || z.priority > best.priority)) best = z;
  }
  return best;
}

/**
 * Follow a shell's path through a ship. Returns null when the first plate on the path is farther than this step's segment:
 * nothing has been hit yet. Otherwise the shell meets each plate in turn: armour that is too thick or too oblique stops or
 * glances it; a plate of 30 mm or more that it gets through starts its fuze, and it bursts after the fuze delay wherever
 * it has then got to. A shell that never starts its fuze, or whose burst point is outside the hull, goes straight through.
 */
export function traceShell(
  geom: HitGeometry,
  trainOf: (turretId: string) => number,
  shell: TraceShell,
  ray: TraceRay,
): TraceResult | null {
  const { origin: o, dir: d } = ray;
  const maxT = ray.segment + EXTENSION;
  const list: Crossing[] = [];
  crossings(geom.plates, o, d, maxT, list);
  for (const t of geom.turrets) {
    const train = trainOf(t.id);
    const [ox, oz] = toTurret(o[0] - t.axisX, o[2] - t.axisZ, train);
    const [dx, dz] = toTurret(d[0], d[2], train);
    crossings(t.plates, [ox, o[1], oz], [dx, d[1], dz], maxT, list);
  }
  if (list.length === 0) return null;
  list.sort((a, b) => a.t - b.t);
  if (list[0]!.t > ray.segment) return null;

  const at = (t: number): V3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const firstC = list[0]!;
  const common = { first: firstC.plate, entry: at(firstC.t), cosTheta: firstC.cos };

  let speed = shell.speed;
  let fuzeAt: number | null = null;
  let burstT: number | null = null;
  const crossed: Plate[] = [];
  let stopped: { c: Crossing; kind: 'ricochet' | 'shatter' } | null = null;
  let barbettePenetrated = false;
  let lastCrossT = firstC.t;

  for (const c of list) {
    const delay = shell.impact ? IMPACT_DELAY_SECONDS : FUZE_DELAY_SECONDS;
    if (fuzeAt !== null && c.t > fuzeAt + speed * delay) break;
    const r = throughPlate(speed, shell.massKg, shell.diameterMm, c.plate.mm, c.cos);
    if (r.outcome !== 'penetrate') {
      if (fuzeAt === null) {
        stopped = { c, kind: r.outcome };
      } else {
        // Already inside with the fuze running: stopped by an inner plate, it bursts against it.
        burstT = c.t;
      }
      break;
    }
    speed = r.speed;
    crossed.push(c.plate);
    lastCrossT = c.t;
    if (c.plate.kind === 'barbette') barbettePenetrated = true;
    if (fuzeAt === null && c.plate.mm >= (shell.impact ? IMPACT_TRIGGER_MM : FUZE_TRIGGER_MM)) fuzeAt = c.t;
  }

  if (stopped) {
    return {
      ...common,
      kind: stopped.kind,
      at: at(stopped.c.t),
      speed,
      zone: null,
      crossed,
      stoppedBy: stopped.c.plate,
      barbettePenetrated,
    };
  }
  if (fuzeAt !== null) {
    const t = burstT ?? fuzeAt + speed * (shell.impact ? IMPACT_DELAY_SECONDS : FUZE_DELAY_SECONDS);
    const p = at(t);
    const zone = zoneAt(geom, p, trainOf);
    if (zone) return { ...common, kind: 'burst', at: p, speed, zone, crossed, barbettePenetrated };
  }
  // Through and out, or through thin structure only: it keeps flying from where it left the last plate it crossed.
  const exit = at(lastCrossT + 0.4);
  return { ...common, kind: 'pass', at: exit, speed, zone: null, crossed, barbettePenetrated };
}
