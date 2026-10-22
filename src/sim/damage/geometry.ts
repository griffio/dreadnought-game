import { deckHeightAtX, waterlineHalfBreadth, keelDepth } from '../../render/ships/forge/hull';
import type { ShipSpec } from '../../render/ships/forge/spec';
import type { DamageSpec } from './spec';

export type V3 = [number, number, number];

export type PlateKind =
  | 'belt'
  | 'upper-side'
  | 'side'
  | 'deck'
  | 'end'
  | 'bottom'
  | 'turret-face'
  | 'turret-side'
  | 'turret-roof'
  | 'barbette'
  | 'funnel'
  | 'superstructure'
  | 'conning'
  | 'mast';

/**
 * A rectangle of armour or plating in a plane perpendicular to one axis (0 = x, 1 = y, 2 = z). `lo` and `hi` bound it along
 * the other two axes in ascending axis order (for a plate across x: y then z; across y: x then z; across z: x then y).
 */
export interface Plate {
  id: string;
  kind: PlateKind;
  axis: 0 | 1 | 2;
  coord: number;
  lo: [number, number];
  hi: [number, number];
  mm: number;
  /** The part of the ship it belongs to, for the damage it can cause: 'turret:A', 'funnel:0', 'bridge:1', 'director:0'... */
  component?: string;
}

export type ZoneKind = 'compartment' | 'barbette' | 'turret' | 'funnel' | 'bridge' | 'conning' | 'director';

/** A volume a burst can happen in. Higher priority wins where zones overlap (a barbette sits inside the hull). */
export interface Zone {
  id: string;
  kind: ZoneKind;
  min: V3;
  max: V3;
  /** Compartment id or component id. */
  ref: string;
  priority: number;
}

/** A turret's house: its plates and zone are in the turret's own frame (origin on its axis, +x along the guns). */
export interface TurretFrame {
  id: string;
  /** Position of the training axis in ship space (x, z). */
  axisX: number;
  axisZ: number;
  plates: Plate[];
  zone: Zone;
}

export interface HitGeometry {
  /** Plates in ship space: hull, decks, barbettes, funnels, superstructure. */
  plates: Plate[];
  zones: Zone[];
  turrets: TurretFrame[];
  /** Hull outline per compartment, for locating a burst's compartment and a hole's side. */
  hull: { halfBreadth: (x: number) => number; deckHeight: (x: number) => number; keel: (x: number) => number; length: number };
}

/** Height of the waterline belt: from just below the water to a little above it. */
export const BELT_BOTTOM = -1.8;
export const BELT_TOP = 1.9;
const THIN = 12;

function box(
  id: string,
  kind: PlateKind,
  min: V3,
  max: V3,
  mm: { sides: number; top?: number },
  component: string,
  out: Plate[],
): void {
  const plate = (axis: 0 | 1 | 2, coord: number, suffix: string, thickness: number): void => {
    const others = ([0, 1, 2] as const).filter((a) => a !== axis);
    out.push({
      id: `${id}.${suffix}`,
      kind,
      axis,
      coord,
      lo: [min[others[0]!], min[others[1]!]],
      hi: [max[others[0]!], max[others[1]!]],
      mm: thickness,
      component,
    });
  };
  plate(0, min[0], 'aft', mm.sides);
  plate(0, max[0], 'fore', mm.sides);
  plate(2, min[2], 'port', mm.sides);
  plate(2, max[2], 'stbd', mm.sides);
  if (mm.top !== undefined) plate(1, max[1], 'top', mm.top);
}

/** Build the plates and zones a shell can meet, from a ship's model spec and its damage spec. */
export function buildHitGeometry(ship: ShipSpec, dmg: DamageSpec): HitGeometry {
  const h = ship.hull;
  const u = (x: number) => Math.min(Math.max(x / h.length + 0.5, 0), 1);
  const halfBreadth = (x: number) => Math.max(waterlineHalfBreadth(h, u(x)), 1.2);
  const deckY = (x: number) => deckHeightAtX(h, x);
  const keel = (x: number) => keelDepth(h, u(x));
  const a = dmg.armor;
  const within = (x: number, lo: number, hi: number) => x >= lo && x <= hi;

  const plates: Plate[] = [];
  const zones: Zone[] = [];

  for (const c of dmg.compartments) {
    const xm = (c.x0 + c.x1) / 2;
    const hb = halfBreadth(xm);
    const top = deckY(xm);
    const bottom = -keel(xm);
    const beltMm = within(xm, a.belt.x0, a.belt.x1) ? a.belt.mm : Math.max(a.belt.endsMm, a.plating);
    const upperMm = within(xm, a.upperSide.x0, a.upperSide.x1) ? a.upperSide.mm : a.plating;
    const deckMm = within(xm, a.deck.x0, a.deck.x1) ? a.deck.mm : a.plating;
    for (const s of [-1, 1] as const) {
      const side = s < 0 ? 'port' : 'stbd';
      const zc = s * hb;
      plates.push({ id: `${c.id}.${side}.low`, kind: 'side', axis: 2, coord: zc, lo: [c.x0, bottom], hi: [c.x1, BELT_BOTTOM], mm: a.plating });
      plates.push({ id: `${c.id}.${side}.belt`, kind: 'belt', axis: 2, coord: zc, lo: [c.x0, BELT_BOTTOM], hi: [c.x1, BELT_TOP], mm: beltMm });
      plates.push({ id: `${c.id}.${side}.upper`, kind: 'upper-side', axis: 2, coord: zc, lo: [c.x0, BELT_TOP], hi: [c.x1, top], mm: upperMm });
    }
    plates.push({ id: `${c.id}.deck`, kind: 'deck', axis: 1, coord: top, lo: [c.x0, -hb], hi: [c.x1, hb], mm: deckMm });
    plates.push({ id: `${c.id}.keel`, kind: 'bottom', axis: 1, coord: bottom, lo: [c.x0, -hb], hi: [c.x1, hb], mm: a.plating });
    zones.push({ id: `zone.${c.id}`, kind: 'compartment', min: [c.x0, bottom, -hb], max: [c.x1, top, hb], ref: c.id, priority: 1 });
  }
  // The stem and the stern post.
  const first = dmg.compartments.reduce((m, c) => (c.x0 < m.x0 ? c : m));
  const last = dmg.compartments.reduce((m, c) => (c.x1 > m.x1 ? c : m));
  for (const [c, x] of [
    [first, first.x0],
    [last, last.x1],
  ] as const) {
    const hb = halfBreadth(x < 0 ? x + 2 : x - 2);
    plates.push({ id: `${c.id}.end.${x < 0 ? 'aft' : 'fore'}`, kind: 'end', axis: 0, coord: x, lo: [-keel(x), -hb], hi: [deckY(x), hb], mm: a.plating });
  }

  // Barbettes and turret houses.
  const turrets: TurretFrame[] = [];
  for (const t of ship.turrets) {
    const small = t.boreMm <= 200 && a.light !== undefined;
    const armor = small ? a.light! : { face: a.turretFace, side: a.turretSide, roof: a.turretRoof, barbette: a.barbette };
    const deck = deckY(t.x);
    const r = t.barbetteRadius;
    const baseY = deck + t.barbetteHeight;
    box(
      `barbette.${t.id}`,
      'barbette',
      [t.x - r, -4, t.z - r],
      [t.x + r, baseY, t.z + r],
      { sides: armor.barbette },
      `barbette:${t.id}`,
      plates,
    );
    zones.push({ id: `zone.barbette.${t.id}`, kind: 'barbette', min: [t.x - r, -4, t.z - r], max: [t.x + r, baseY, t.z + r], ref: t.id, priority: 3 });

    const { rear, front, width, height } = t.house;
    const local: Plate[] = [];
    const lo: V3 = [-rear, baseY, -width / 2];
    const hi: V3 = [front, baseY + height, width / 2];
    const pl = (axis: 0 | 1 | 2, coord: number, suffix: string, kind: PlateKind, mm: number) => {
      const others = ([0, 1, 2] as const).filter((q) => q !== axis);
      local.push({ id: `turret.${t.id}.${suffix}`, kind, axis, coord, lo: [lo[others[0]!], lo[others[1]!]], hi: [hi[others[0]!], hi[others[1]!]], mm, component: `turret:${t.id}` });
    };
    pl(0, front, 'face', 'turret-face', armor.face);
    pl(0, -rear, 'rear', 'turret-side', Math.round(armor.side * 0.75));
    pl(2, -width / 2, 'port', 'turret-side', armor.side);
    pl(2, width / 2, 'stbd', 'turret-side', armor.side);
    pl(1, hi[1], 'roof', 'turret-roof', armor.roof);
    turrets.push({
      id: t.id,
      axisX: t.x,
      axisZ: t.z,
      plates: local,
      zone: { id: `zone.turret.${t.id}`, kind: 'turret', min: lo, max: hi, ref: t.id, priority: 4 },
    });
  }

  // Funnels, superstructure, conning tower and the director on the mast: light structure that can still be hurt.
  ship.funnels.forEach((f, i) => {
    const z = f.z ?? 0;
    const y0 = deckY(f.x) - 0.2;
    const mn: V3 = [f.x - f.halfLength, y0, z - f.halfWidth];
    const mx: V3 = [f.x + f.halfLength, y0 + f.height, z + f.halfWidth];
    box(`funnel.${i}`, 'funnel', mn, mx, { sides: THIN, top: 6 }, `funnel:${i}`, plates);
    zones.push({ id: `zone.funnel.${i}`, kind: 'funnel', min: mn, max: mx, ref: `funnel:${i}`, priority: 2 });
  });
  ship.blocks.forEach((b, i) => {
    const y0 = deckY(b.x) + (b.lift ?? 0);
    const z = b.z ?? 0;
    const mn: V3 = [b.x - b.length / 2, y0, z - b.width / 2];
    const mx: V3 = [b.x + b.length / 2, y0 + b.height, z + b.width / 2];
    box(`block.${i}`, 'superstructure', mn, mx, { sides: THIN, top: THIN }, `bridge:${i}`, plates);
    zones.push({ id: `zone.block.${i}`, kind: 'bridge', min: mn, max: mx, ref: `bridge:${i}`, priority: 2 });
  });
  if (ship.conning) {
    const c = ship.conning;
    const y0 = deckY(c.x) + c.lift;
    const mn: V3 = [c.x - c.radius, y0, -c.radius];
    const mx: V3 = [c.x + c.radius, y0 + c.height, c.radius];
    box('conning', 'conning', mn, mx, { sides: dmg.armor.conning, top: Math.round(dmg.armor.conning * 0.3) }, 'conning:0', plates);
    zones.push({ id: 'zone.conning', kind: 'conning', min: mn, max: mx, ref: 'conning:0', priority: 3 });
  }
  ship.masts.forEach((m, i) => {
    const baseY = Math.max(...m.legs.map(([x]) => deckY(x))) - 0.2;
    const px = m.legs.reduce((s, l) => s + l[0], 0) / m.legs.length;
    const r = Math.max(m.platformRadius, 1);
    const mn: V3 = [px - r, baseY + m.height - 0.6, -r];
    const mx: V3 = [px + r, baseY + m.height + 2.2, r];
    box(`mast.${i}`, 'mast', mn, mx, { sides: 6, top: 6 }, `director:${i}`, plates);
    zones.push({ id: `zone.director.${i}`, kind: 'director', min: mn, max: mx, ref: `director:${i}`, priority: 2 });
  });

  return { plates, zones, turrets, hull: { halfBreadth, deckHeight: deckY, keel, length: h.length } };
}
