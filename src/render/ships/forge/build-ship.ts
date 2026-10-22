import { buildHull, waterlineHalfBreadth } from './hull';
import { MeshBuilder } from './mesh-builder';
import {
  addBlock,
  addBoat,
  addConning,
  addFunnel,
  addLightGun,
  addMast,
  addSearchlight,
  addStaff,
  addTurret,
  addVent,
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
  };
}
