// Depth-only pass from the sun. Same node-table skinning and curvature drop as the main ship shader so the
// shadow map and the lit geometry agree. Scene at group 0, ship instance at group 1. Requires scene, ship_u.
@group(1) @binding(0) var<uniform> ship: ShipU;

const EARTH_R: f32 = 6371000.0;

struct VIn {
  @location(0) pos: vec3<f32>,
  @location(2) ids: u32,
};

@vertex
fn vs(in: VIn) -> @builtin(position) vec4<f32> {
  let nm = ship.nodes[in.ids & 0xffu];
  var pos = in.pos;
  // A ship broken in two casts only the shadow of the part that is drawn: what lies on the other side of the break is flattened onto it.
  if (ship.split.y != 0.0 && (pos.x - ship.split.x) * ship.split.y < 0.0) {
    pos.x = ship.split.x;
  }
  var p_rel = (ship.model * (nm * vec4<f32>(pos, 1.0))).xyz;
  p_rel.y -= dot(p_rel.xz, p_rel.xz) / (2.0 * EARTH_R);
  return scene.shadow_vp * vec4<f32>(p_rel, 1.0);
}
