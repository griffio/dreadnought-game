// The land: tiled heightfield meshes, one draw per visible tile. Positions are tile-local; the tile's camera-relative origin
// comes from a storage buffer indexed by the instance, so a whole island is a handful of draws and a float32 position never
// has to hold a coordinate in kilometres.
//   Requires common, scene, sky_map, env, noise, haze. Group 2 = tile origins.
const EARTH_R: f32 = 6371000.0;

@group(2) @binding(0) var<storage, read> tiles: array<vec4<f32>>;

struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @builtin(instance_index) inst: u32,
};

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) rel: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) world: vec3<f32>,
};

@vertex
fn vs(in: VIn) -> VOut {
  let t = tiles[in.inst * 2u];
  let w = tiles[in.inst * 2u + 1u];
  var rel = vec3<f32>(t.x + in.pos.x, in.pos.y - scene.cam_pos.y, t.z + in.pos.z);
  rel.y -= dot(rel.xz, rel.xz) / (2.0 * EARTH_R);
  var out: VOut;
  out.clip = scene.view_proj * vec4<f32>(rel, 1.0);
  out.rel = rel;
  out.nrm = in.nrm;
  out.world = vec3<f32>(w.x + in.pos.x, in.pos.y, w.y + in.pos.z);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let n = normalize(in.nrm);
  let h = in.world.y;
  let p = in.world.xz;
  // Detail at three scales from the baked noise texture: broad patches of scrub and bare earth, and grain.
  let broad = noise_lookup(p * 0.0021);
  let mid = noise_lookup(p * 0.011);
  let fine = noise_lookup(p * 0.09);

  let steep = 1.0 - smoothstep(0.55, 0.85, n.y);
  // Dry Mediterranean ground: olive scrub, bleached grass higher up, bare earth and rock where it is steep.
  var scrub = mix(vec3<f32>(0.20, 0.215, 0.105), vec3<f32>(0.30, 0.275, 0.15), broad);
  scrub = mix(scrub, vec3<f32>(0.37, 0.33, 0.21), smoothstep(40.0, 150.0, h) * 0.8);
  scrub *= 0.7 + 0.6 * mid;
  // Dark gullies and bright bare patches on the larger scale.
  scrub = mix(scrub, vec3<f32>(0.11, 0.13, 0.07), smoothstep(0.55, 0.8, broad) * 0.6);
  let rock = mix(vec3<f32>(0.30, 0.27, 0.235), vec3<f32>(0.42, 0.385, 0.335), fine) * (0.8 + 0.4 * broad);
  var albedo = mix(scrub, rock, smoothstep(0.1, 0.7, steep + smoothstep(120.0, 190.0, h) * 0.4));
  // Beach and wet sand at the waterline.
  let sand = mix(vec3<f32>(0.46, 0.41, 0.31), vec3<f32>(0.55, 0.50, 0.39), fine);
  albedo = mix(albedo, sand, 1.0 - smoothstep(0.6, 4.0, h + (mid - 0.5) * 3.0));
  albedo = mix(albedo, albedo * vec3<f32>(0.55, 0.5, 0.45), 1.0 - smoothstep(0.0, 1.0, h));
  albedo *= 0.9 + 0.2 * fine;

  let l = scene.sun_dir.xyz;
  let nl = saturate(dot(n, l)) * saturate(l.y * 3.0 + 0.1);
  let amb = scene.ambient.rgb * mix(0.4, 1.0, 0.5 + 0.5 * n.y);
  var col = albedo * (amb * 1.15 + scene.sun_irr.rgb * (nl / PI));
  col = apply_haze(col, in.rel);
  return vec4<f32>(col, 1.0);
}
