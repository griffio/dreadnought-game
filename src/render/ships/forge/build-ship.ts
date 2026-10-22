import { buildHull, waterlineHalfBreadth } from './hull';
import { MeshBuilder } from './mesh-builder';
import {
  addBlock,
  addBoat,
  addFlag,
  addConning,
  addFunnel,
  addLightGun,
  addMast,
  addSearchlight,
  addStaff,
  addTurret,
  addVent,
  mastGaffEnd,
  NodeTable,
} from './parts';
import type { ShipModel, ShipSpec } from './spec';
import { deckHeightAtX } from './hull';

/** Turn a declarative ShipSpec into packed, node-tagged geometry ready for the ship pipeline. */
export function buildShip(spec: ShipSpec): ShipModel {
  const b = new MeshBuilder();
  const nodes = new NodeTable();
  const { hull } = spec;

  buildHull(b, hull);
  for (const blk of spec.blocks) addBlock(b, hull, blk);
  if (spec.conning) addConning(b, hull, spec.conning);
  for (const f of spec.funnels) addFunnel(b, hull, f);
  for (const m of spec.masts) addMast(b, hull, m);
  for (const bt of spec.boats) addBoat(b, hull, bt);
  for (const v of spec.vents) addVent(b, hull, v);
  for (const l of spec.lights) addSearchlight(b, hull, l);
  b.node = 0;
  for (const g of spec.lightGuns) addLightGun(b, [g.x, deckHeightAtX(hull, g.x) + g.lift, g.z], g.trainDeg);
  for (const s of spec.staffs) addStaff(b, hull, s);
  const turrets = spec.turrets.map((t) => addTurret(b, nodes, hull, t));

  // Her flags: the ensign at the staff aft, and the battle ensign (larger) at the gaff of her aftermost mast.
  const flags: number[] = [];
  const flagLength = Math.min(Math.max(hull.length * 0.021, 2.0), 4.2);
  const aftStaff = spec.staffs.length > 0 ? spec.staffs.reduce((a, s) => (s.x < a.x ? s : a)) : null;
  if (aftStaff) flags.push(addFlag(b, nodes, 'ensign', aftStaff.x, deckHeightAtX(hull, aftStaff.x) + aftStaff.height - 0.2, 0, flagLength));
  if (spec.masts.length > 0) {
    const aftMast = spec.masts.reduce((a, m) => (Math.min(...m.legs.map((l) => l[0])) < Math.min(...a.legs.map((l) => l[0])) ? m : a));
    const gaff = mastGaffEnd(hull, aftMast);
    flags.push(addFlag(b, nodes, 'battle', gaff[0], gaff[1] - 0.05, gaff[2], flagLength * 1.3));
  }

  let maxHeight = 0;
  for (let i = 1; i < b.positions.length; i += 3) maxHeight = Math.max(maxHeight, b.positions[i]!);

  const packed = b.pack();
  return {
    name: spec.name,
    vertices: packed.vertices,
    vertexCount: packed.vertexCount,
    indices: packed.indices,
    nodes: nodes.nodes,
    turrets,
    length: hull.length,
    beam: hull.beam,
    draft: hull.draft,
    waterlineHalfBreadthAt: (x: number) => waterlineHalfBreadth(hull, Math.min(Math.max(x / hull.length + 0.5, 0), 1)),
    maxHeight,
    deckHeightAt: (x: number) => deckHeightAtX(hull, x),
    flags,
  };
}
