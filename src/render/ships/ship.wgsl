// Ship pipeline: one draw per ship. Vertices carry an animation node and a material id; node matrices live in a
// uniform table. Surfaces are procedural: plating seams, deck planks, boot-topping, weathering.
// Requires common, scene, sky_map, env, haze, shadow, ship_u. Group 2 = ship instance.
const EARTH_R: f32 = 6371000.0;

@group(2) @binding(0) var<uniform> ship: ShipU;

struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) ids: u32,
  @location(3) aux: u32,
};

struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) rel: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) obj: vec3<f32>,
  @location(3) nrm_obj: vec3<f32>,
  @location(4) @interpolate(flat) ids: u32,
  @location(5) @interpolate(flat) aux: u32,
};

@vertex
fn vs(in: VIn) -> VOut {
  let nm = ship.nodes[in.ids & 0xffu];
  let p_ship = nm * vec4<f32>(in.pos, 1.0);
  let n_ship = (nm * vec4<f32>(in.nrm, 0.0)).xyz;
  var p_rel = (ship.model * p_ship).xyz;
  let n_rel = normalize((ship.model * vec4<f32>(n_ship, 0.0)).xyz);
  p_rel.y -= dot(p_rel.xz, p_rel.xz) / (2.0 * EARTH_R);

  var out: VOut;
  out.clip = scene.view_proj * vec4<f32>(p_rel, 1.0);
  out.rel = p_rel;
  out.nrm = n_rel;
  out.obj = in.pos;
  out.nrm_obj = in.nrm;
  out.ids = in.ids;
  out.aux = in.aux;
  return out;
}

struct Surf {
  albedo: vec3<f32>,
  rough: f32,
  metal: f32,
  ao: f32,
  /** Light the surface gives out (a fresh hole, still hot), in the units of the muzzle glows. */
  emit: vec3<f32>,
};

// The weathering atlas (see tools/process-textures.py): layers are data, not colours. Detail layers hold a value about one half;
// masks hold nothing where the ship is clean.
@group(1) @binding(3) var weather: texture_2d_array<f32>;
@group(1) @binding(4) var decal_tex: texture_2d_array<f32>;
@group(1) @binding(5) var weather_samp: sampler;
const L_STEEL: i32 = 0;   // R plating detail, G fine scratches
const L_WEAR: i32 = 1;    // R rust and bare metal where the paint has gone, G lighter chips, B the paint's mottling
const L_STREAK: i32 = 2;  // R rust drips
const L_GRIME: i32 = 3;   // R grime and soot
const L_WOOD: i32 = 4;    // R planking grain, G caulking
const L_RIVET: i32 = 5;   // R armour plating detail

const M_HULL: u32 = 0u;
const M_DECK: u32 = 1u;
const M_SUPER: u32 = 2u;
const M_FUNNEL: u32 = 3u;
const M_GUN: u32 = 4u;
const M_TURRET: u32 = 5u;
const M_MAST: u32 = 6u;
const M_WOOD: u32 = 7u;
const M_BLACK: u32 = 8u;
const M_BRASS: u32 = 9u;

// A tiling layer sampled on the three planes of ship space, blended by the way the surface faces. `scale` is tiles per metre; dx and dy
// are the screen derivatives of the position (worked out where every pixel runs, so that they are valid here).
fn tri(layer: i32, p: vec3<f32>, n: vec3<f32>, scale: f32, dx: vec3<f32>, dy: vec3<f32>) -> vec4<f32> {
  var w = pow(abs(n), vec3<f32>(5.0));
  w = w * vec3<f32>(step(0.03, w.x / (w.x + w.y + w.z + 1e-5)), step(0.03, w.y / (w.x + w.y + w.z + 1e-5)), step(0.03, w.z / (w.x + w.y + w.z + 1e-5)));
  var c = vec4<f32>(0.0);
  if (w.x > 0.0) { c += w.x * textureSampleGrad(weather, weather_samp, p.zy * scale, layer, dx.zy * scale, dy.zy * scale); }
  if (w.y > 0.0) { c += w.y * textureSampleGrad(weather, weather_samp, p.xz * scale, layer, dx.xz * scale, dy.xz * scale); }
  if (w.z > 0.0) { c += w.z * textureSampleGrad(weather, weather_samp, p.xy * scale, layer, dx.xy * scale, dy.xy * scale); }
  return c / max(w.x + w.y + w.z, 1e-4);
}

// One plane only: along the ship for her sides, across for her ends. `scale` is tiles per metre along and up.
fn side_tex(layer: i32, p: vec3<f32>, n: vec3<f32>, scale: vec2<f32>, dx: vec3<f32>, dy: vec3<f32>) -> vec4<f32> {
  let across = abs(n.x) > 0.6;
  let h = select(p.x, p.z, across);
  let hx = select(dx.x, dx.z, across);
  let hy = select(dy.x, dy.z, across);
  return textureSampleGrad(weather, weather_samp, vec2<f32>(h, p.y) * scale, layer, vec2<f32>(hx, dx.y) * scale, vec2<f32>(hy, dy.y) * scale);
}

// Staggered rectangular plating: seam darkening plus a little per-plate tone variation.
// `along` picks which horizontal axis the plates run on (the one facing the surface normal's tangent).
fn plating(obj: vec3<f32>, n: vec3<f32>, plate: vec2<f32>) -> vec2<f32> {
  let horiz = select(obj.x, obj.z, abs(n.x) > 0.6);
  let row = floor(obj.y / plate.y);
  let stagger = select(0.0, 0.5, (i32(row) & 1) == 1);
  let uv = vec2<f32>(horiz / plate.x + stagger, obj.y / plate.y);
  let cell = floor(uv);
  let f = fract(uv);
  let edge = min(min(f.x * plate.x, (1.0 - f.x) * plate.x), min(f.y * plate.y, (1.0 - f.y) * plate.y));
  let seam = 1.0 - smoothstep(0.0, 0.04, edge);
  return vec2<f32>(seam, hash21(cell));
}

fn hull_surface(obj: vec3<f32>, n: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  let pl = plating(obj, n, vec2<f32>(3.1, 1.55));
  var col = ship.hull_grey.rgb * (0.93 + 0.14 * pl.y);
  col *= 1.0 - 0.15 * pl.x;

  // Above the waterline: the plating's own detail, then the weathering, in proportion to how long she has been at sea.
  let weathering = ship.clock.y;
  let above = smoothstep(-0.9, -0.4, obj.y);
  let steel = tri(L_STEEL, obj, n, 0.2, dx, dy);
  col *= 1.0 + ((steel.r - 0.5) * 0.75 + (steel.g - 0.5) * 0.35) * above;
  // Paint worn through to rust and bare metal, and lighter chips where it lifts.
  let wear = tri(L_WEAR, obj, n, 0.16, dx, dy);
  // Rust does not fall evenly: it gathers in patches, and more of it low down and under the deck edge.
  let along = select(obj.x, obj.z, abs(n.x) > 0.6);
  let blotch = smoothstep(0.32, 0.7, fbm(vec2<f32>(along * 0.1, obj.y * 0.2), 3));
  let rust = clamp(wear.r * weathering * above * mix(0.18, 1.0, blotch) * (0.55 + 0.6 * (1.0 - smoothstep(0.5, 6.0, obj.y))), 0.0, 1.0);
  col = mix(col, vec3<f32>(0.16, 0.075, 0.04) * (0.65 + 0.9 * wear.b), rust * 0.85);
  col *= 1.0 + wear.g * weathering * above * 0.35;
  // Rust drips from the deck edge and the scuppers, and grime and soot that gather low.
  let drip = side_tex(L_STREAK, obj, n, vec2<f32>(0.34, 0.085), dx, dy).r;
  col = mix(col, vec3<f32>(0.13, 0.07, 0.045), drip * weathering * 0.62 * smoothstep(0.5, 4.5, obj.y));
  let grime = tri(L_GRIME, obj, n, 0.1, dx, dy).r;
  col *= 1.0 - grime * weathering * above * (0.3 + 0.25 * (1.0 - smoothstep(0.0, 4.0, obj.y)));

  // Boot-topping band at the waterline, anti-fouling red below it.
  let boot = smoothstep(-1.15, -0.95, obj.y) * (1.0 - smoothstep(0.35, 0.55, obj.y));
  col = mix(col, vec3<f32>(0.012, 0.012, 0.013), boot);
  let bottom = 1.0 - smoothstep(-1.15, -0.95, obj.y);
  col = mix(col, vec3<f32>(0.18, 0.03, 0.025), bottom);

  var s: Surf;
  s.albedo = col;
  s.rough = 0.62 + 0.3 * rust;
  s.metal = 0.0;
  s.ao = mix(0.5, 1.0, smoothstep(-0.2, 3.0, obj.y));
  return s;
}

fn deck_surface(obj: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  if (ship.misc.y > 0.5) {
    // A fort's apron: poured concrete in slabs with expansion joints, stained and cracked a little.
    let cell = floor(obj.xz / vec2<f32>(6.5, 5.2));
    let f = fract(obj.xz / vec2<f32>(6.5, 5.2));
    let joint = 1.0 - smoothstep(0.0, 0.03, min(min(f.x, 1.0 - f.x) * 6.5, min(f.y, 1.0 - f.y) * 5.2));
    let stain = fbm(obj.xz * 0.35, 3);
    var c = vec3<f32>(0.40, 0.385, 0.35) * (0.82 + 0.3 * hash21(cell)) * (0.8 + 0.4 * stain);
    c *= 1.0 - 0.45 * joint;
    var cs: Surf;
    cs.albedo = c;
    cs.rough = 0.9;
    cs.metal = 0.0;
    cs.ao = 0.9;
    return cs;
  }
  // Planks run fore-and-aft: seams every 0.19 m across, butt joints staggered every few metres.
  let pz = obj.z / 0.19;
  let plank = floor(pz);
  let pf = fract(pz);
  let seam = 1.0 - smoothstep(0.0, 0.08, min(pf, 1.0 - pf));
  let px = obj.x / 3.6 + hash21(vec2<f32>(plank, 3.0)) * 5.0;
  let bf = fract(px);
  let butt = (1.0 - smoothstep(0.0, 0.02, min(bf, 1.0 - bf))) * 0.6;
  let tone = hash21(vec2<f32>(plank, floor(px)));
  var col = vec3<f32>(0.40, 0.29, 0.18) * (0.78 + 0.34 * tone);
  col = mix(col, vec3<f32>(0.46, 0.41, 0.33), 0.25); // sun-bleached
  // The grain and the caulking come from the picture (planks run along the ship); the seams and butt joints above only lay them out.
  let wood = textureSampleGrad(weather, weather_samp, obj.xz * 0.47, L_WOOD, dx.xz * 0.47, dy.xz * 0.47);
  col *= 0.72 + 0.56 * wood.r;
  col *= 1.0 - 0.4 * wood.g;
  col *= 1.0 - 0.16 * seam - 0.3 * butt;
  let grime = textureSampleGrad(weather, weather_samp, obj.xz * 0.11, L_GRIME, dx.xz * 0.11, dy.xz * 0.11).r;
  col *= 1.0 - grime * ship.clock.y * 0.35;
  var s: Surf;
  s.albedo = col;
  s.rough = 0.8;
  s.metal = 0.0;
  s.ao = 0.85;
  return s;
}

fn steel_surface(obj: vec3<f32>, n: vec3<f32>, base: vec3<f32>, plate: vec2<f32>, layer: i32, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  let pl = plating(obj, n, plate);
  let weathering = ship.clock.y;
  let detail = tri(layer, obj, n, 0.28, dx, dy);
  let wear = tri(L_WEAR, obj, n, 0.2, dx, dy);
  let grime = tri(L_GRIME, obj, n, 0.13, dx, dy).r;
  var s: Surf;
  var col = base * (0.94 + 0.12 * pl.y) * (1.0 - 0.16 * pl.x);
  col *= 1.0 + (detail.r - 0.5) * 0.7;
  let blotch = smoothstep(0.32, 0.7, fbm(obj.xz * 0.12 + obj.y * 0.17, 3));
  let rust = clamp(wear.r * weathering * 0.55 * mix(0.18, 1.0, blotch), 0.0, 1.0);
  col = mix(col, vec3<f32>(0.15, 0.072, 0.04) * (0.65 + 0.9 * wear.b), rust * 0.8);
  col *= 1.0 - grime * weathering * 0.28;
  s.albedo = col;
  s.rough = 0.6 + 0.25 * rust;
  s.metal = 0.0;
  s.ao = 1.0;
  return s;
}

fn surface(ids: u32, aux: u32, obj: vec3<f32>, n: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  let mid = (ids >> 8u) & 0xffu;
  var s: Surf;
  s.albedo = vec3<f32>(0.3);
  s.rough = 0.6;
  s.metal = 0.0;
  s.ao = 1.0;
  switch (mid) {
    case M_HULL: {
      s = hull_surface(obj, n, dx, dy);
    }
    case M_DECK: {
      s = deck_surface(obj, dx, dy);
    }
    case M_SUPER: {
      s = steel_surface(obj, n, ship.super_grey.rgb, vec2<f32>(2.4, 1.2), L_STEEL, dx, dy);
    }
    case M_TURRET: {
      s = steel_surface(obj, n, ship.hull_grey.rgb * 0.9, vec2<f32>(1.9, 1.0), L_RIVET, dx, dy);
    }
    case M_FUNNEL: {
      let top = f32(aux) * 0.1;
      var col = vec3<f32>(0.62, 0.50, 0.30);
      let soot = smoothstep(top - 5.5, top - 0.5, obj.y);
      col = mix(col, vec3<f32>(0.10, 0.085, 0.07), soot * 0.55);
      col = mix(col, vec3<f32>(0.012), smoothstep(top - 2.2, top - 1.9, obj.y));
      s.albedo = col;
      s.rough = 0.7;
    }
    case M_GUN: {
      s.albedo = vec3<f32>(0.045, 0.048, 0.052);
      s.rough = 0.34;
      s.metal = 0.7;
    }
    case M_MAST: {
      s.albedo = ship.super_grey.rgb * 0.85;
      s.rough = 0.65;
    }
    case M_WOOD: {
      let grain = value_noise(vec2<f32>(obj.x * 1.5, obj.z * 9.0));
      s.albedo = vec3<f32>(0.38, 0.24, 0.12) * (0.8 + 0.4 * grain);
      s.rough = 0.45;
    }
    case M_BLACK: {
      s.albedo = vec3<f32>(0.012);
      s.rough = 0.55;
    }
    case M_BRASS: {
      s.albedo = vec3<f32>(0.62, 0.47, 0.18);
      s.rough = 0.3;
      s.metal = 1.0;
    }
    default: {}
  }
  return s;
}

// The marks of the hits she has taken, projected onto the static hull in ship space. A scorch darkens, a hole is a dark opening with a
// charred, rusted rim, and a fresh one is still hot: it glows, and cools over some seconds. A mark made later than the simulation clock
// is not shown, so that a replay of an earlier moment sees the ship as she was.
fn with_decals(base: Surf, obj: vec3<f32>, n: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  var s = base;
  let count = i32(ship.clock.z);
  if (count == 0) {
    return s;
  }
  let now = ship.clock.x;
  let footprint = max(length(dx), length(dy));
  var soot = 0.0;
  var hole = 0.0;
  var rim = 0.0;
  var edge = 0.5;
  var heat = 0.0;
  for (var i = 0; i < count; i++) {
    let a = ship.decals[i * 3];
    let b = ship.decals[i * 3 + 1];
    let c = ship.decals[i * 3 + 2];
    let age = now - c.x;
    let d = obj - a.xyz;
    let r = a.w;
    if (age < 0.0 || dot(d, d) > r * r * 2.0) {
      continue;
    }
    let nd = b.xyz;
    // On the surface the mark was made on, not through the ship onto her far side or round a corner.
    if (dot(n, nd) < 0.4 || abs(dot(d, nd)) > r * 0.7) {
      continue;
    }
    let up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(nd.y) > 0.9);
    let t = normalize(cross(up, nd));
    let bi = cross(nd, t);
    let ang = c.y * 6.2831853;
    let u0 = dot(d, t) / r;
    let v0 = dot(d, bi) / r;
    let uv = vec2<f32>(u0 * cos(ang) - v0 * sin(ang), u0 * sin(ang) + v0 * cos(ang)) * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      continue;
    }
    let lod = clamp(log2(max(footprint / (2.0 * r) * 256.0, 1.0)), 0.0, 8.0);
    let fade = smoothstep(0.0, 0.12, age);
    let kind = i32(b.w + 0.5);
    if (kind == 2) {
      let h = textureSampleLevel(decal_tex, weather_samp, uv, 2, lod);
      hole = max(hole, h.r * fade);
      rim = max(rim, h.g * fade);
      edge = mix(edge, h.b, h.g * fade);
      heat = max(heat, fade * exp(-age / 16.0));
    } else {
      let m = textureSampleLevel(decal_tex, weather_samp, uv, select(0, 1, kind == 1), lod).r;
      soot = max(soot, m * fade * select(0.8, 0.6, kind == 1));
    }
  }
  s.albedo *= 1.0 - 0.88 * soot;
  s.rough = mix(s.rough, 0.95, soot * 0.6);
  s.albedo = mix(s.albedo, vec3<f32>(0.05, 0.032, 0.022) * (0.5 + edge), rim * 0.9);
  s.albedo = mix(s.albedo, vec3<f32>(0.004), hole);
  s.rough = mix(s.rough, 1.0, max(rim, hole));
  s.ao = mix(s.ao, 0.12, hole);
  s.emit = vec3<f32>(1.0, 0.34, 0.08) * (rim * 0.9 + hole * 0.06) * heat * 1.25;
  return s;
}

// A node that has been burnt: blackened and roughened, with the odd ember still glowing in it. `k` is how far gone it is, 0..1.
fn charred(base: Surf, obj: vec3<f32>, k: f32) -> Surf {
  var s = base;
  let n1 = fbm(obj.xz * 0.9 + obj.y * 1.3, 3);
  let soot = clamp(k * (0.75 + 0.5 * n1), 0.0, 1.0);
  s.albedo = mix(s.albedo, vec3<f32>(0.018, 0.015, 0.013), soot * 0.92);
  // Where the paint has burnt off the bare plate rusts red-brown.
  s.albedo = mix(s.albedo, vec3<f32>(0.11, 0.045, 0.028), k * smoothstep(0.62, 0.8, n1) * 0.5);
  s.rough = mix(s.rough, 0.95, soot);
  s.metal = s.metal * (1.0 - soot);
  let t = ship.clock.x;
  let ember = smoothstep(0.72, 0.9, fbm(obj.xz * 2.7 + obj.y * 3.1 + vec2<f32>(t * 0.05, 0.0), 3)) * k;
  s.emit += vec3<f32>(1.0, 0.3, 0.06) * ember * (0.5 + 0.35 * sin(t * 4.0 + obj.x * 3.0 + obj.z * 2.0));
  return s;
}

// The fires burning in her light the plating round them: a warm flickering glow that falls away over some metres, strongest on the
// surfaces that face the fire. `n` is the surface normal in ship space.
fn fire_glow(obj: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let count = i32(ship.clock.w);
  var glow = vec3<f32>(0.0);
  let t = ship.clock.x;
  for (var i = 0; i < count; i++) {
    let f = ship.fires[i];
    let d = f.xyz - obj;
    let dist = length(d);
    let reach = 1.8 + 3.2 * f.w;
    if (dist > reach * 2.2) {
      continue;
    }
    let facing = 0.35 + 0.65 * saturate(dot(n, d / max(dist, 0.05)) * 0.5 + 0.5);
    let flicker = 0.72 + 0.18 * sin(t * 9.0 + f32(i) * 3.1 + dist * 0.8) + 0.1 * sin(t * 23.0 + f32(i) * 7.7);
    let k = exp(-(dist * dist) / (reach * reach)) * f.w * flicker * facing;
    glow += vec3<f32>(1.0, 0.4, 0.09) * k;
  }
  return glow;
}

fn ggx_specular(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, rough: f32, f0: vec3<f32>) -> vec3<f32> {
  let h = normalize(l + v);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a = max(rough * rough, 0.02);
  let a2 = a * a;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  let ndf = a2 / (PI * d * d);
  let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
  let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
  let vis = 0.5 / max(gv + gl, 1e-4);
  let fres = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vh, 5.0);
  return fres * (ndf * vis * nl);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  // The position's screen derivatives, taken before anything can leave the pixel early, for the texture lookups below.
  let dpx = dpdx(in.obj);
  let dpy = dpdy(in.obj);
  // The director's sight sits among the legs of the mast and sees out of it: nothing of the ship that close to the lens is drawn.
  if (ship.misc.z > 0.0 && length(in.rel) < ship.misc.z) {
    discard;
  }
  // A ship that has broken in two is drawn as two parts, each cut off along a torn line: the part on the far side of it is not drawn.
  var tear_char = 0.0;
  var tear_heat = 0.0;
  if (ship.split.y != 0.0) {
    let rag = (fbm(in.obj.zy * vec2<f32>(0.55, 0.8) + vec2<f32>(in.obj.y * 0.3, 7.0), 3) - 0.5) * 2.0 * ship.split.z;
    let into = (in.obj.x - ship.split.x - rag) * ship.split.y;
    if (into < 0.0) {
      discard;
    }
    tear_char = 1.0 - smoothstep(0.0, 3.5, into);
    // The torn edge is red-hot at first, and cools over half a minute.
    tear_heat = (1.0 - smoothstep(0.0, 1.6, into)) * exp(-ship.split.w / 30.0);
  }
  let v = normalize(-in.rel);
  var n = normalize(in.nrm);
  if (dot(n, v) < 0.0) {
    n = -n; // thin sheets (decks, plates) are lit from both sides
  }
  var s = surface(in.ids, in.aux, in.obj, in.nrm_obj, dpx, dpy);
  if (tear_char > 0.0) {
    s = charred(s, in.obj, tear_char * 0.95);
    s.emit += vec3<f32>(1.0, 0.32, 0.06) * tear_heat * (0.55 + 0.45 * fbm(in.obj.zy * 1.7 + vec2<f32>(ship.clock.x * 0.2, 0.0), 3)) * 1.6;
  }
  // Hits leave their marks on the static hull (node 0), not on a turret, which turns under them.
  if ((in.ids & 0xffu) == 0u) {
    s = with_decals(s, in.obj, normalize(in.nrm_obj), dpx, dpy);
  }

  // A turret that has been wrecked, and anything else burnt, is black, and the odd ember glows in it.
  let node = in.ids & 0xffu;
  let burnt = ship.node_char[node >> 2u][node & 3u];
  if (burnt > 0.0) {
    s = charred(s, in.obj, burnt);
  }

  // Wet lower hull: darker and glossier where spray and waves reach.
  let mid = (in.ids >> 8u) & 0xffu;
  if (mid == M_HULL) {
    let wet = smoothstep(2.0, 0.2, in.obj.y) * ship.misc.x;
    s.albedo *= 1.0 - 0.45 * wet;
    s.rough = mix(s.rough, 0.28, wet);
  }

  let l = scene.sun_dir.xyz;
  let nl = saturate(dot(n, l));
  let sh = shadow_factor(in.rel, n);
  let sun = scene.sun_irr.rgb;

  let amb = scene.ambient.rgb * mix(0.35, 1.0, 0.5 + 0.5 * n.y) * s.ao;
  let diffuse_colour = s.albedo * (1.0 - s.metal);
  var col = diffuse_colour * (amb + sun * (nl * sh / PI));

  let f0 = mix(vec3<f32>(0.04), s.albedo, s.metal);
  col += ggx_specular(n, v, l, s.rough, f0) * sun * sh;

  // Sky/sea reflection, strongest on glossy and grazing surfaces.
  var r = reflect(-v, n);
  let sea = scene.ambient.rgb * 0.18;
  let up = env_radiance(vec3<f32>(r.x, max(r.y, 0.02), r.z));
  let env = mix(sea, up, smoothstep(-0.25, 0.1, r.y));
  let nv = max(dot(n, v), 0.0);
  let gloss = (1.0 - s.rough) * (1.0 - s.rough);
  col += env * (f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - nv, 5.0)) * gloss * s.ao;

  col += s.emit / scene.sun_irr.w;
  col += fire_glow(in.obj, normalize(in.nrm_obj)) * 0.3 / scene.sun_irr.w;
  col = apply_haze(col, in.rel);
  return vec4<f32>(col, 1.0);
}
