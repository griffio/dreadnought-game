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
  var p_rel = (ship.model * (nm * vec4<f32>(in.pos, 1.0))).xyz;
  p_rel.y -= dot(p_rel.xz, p_rel.xz) / (2.0 * EARTH_R);
  return scene.shadow_vp * vec4<f32>(p_rel, 1.0);
}
