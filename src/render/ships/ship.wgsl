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
};

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

fn hull_surface(obj: vec3<f32>, n: vec3<f32>) -> Surf {
  let pl = plating(obj, n, vec2<f32>(3.1, 1.55));
  var col = ship.hull_grey.rgb * (0.93 + 0.14 * pl.y);
  col *= 1.0 - 0.15 * pl.x;

  // Rust streaks running down from the deck edge and scuppers.
  let h = select(obj.x, obj.z, abs(n.x) > 0.6);
  let streak = fbm(vec2<f32>(h * 1.6, obj.y * 0.14), 3);
  let rust = smoothstep(0.58, 0.85, streak) * smoothstep(0.5, 4.5, obj.y) * 0.34;
  col = mix(col, vec3<f32>(0.14, 0.075, 0.045), rust);

  // Boot-topping band at the waterline, anti-fouling red below it.
  let boot = smoothstep(-1.15, -0.95, obj.y) * (1.0 - smoothstep(0.35, 0.55, obj.y));
  col = mix(col, vec3<f32>(0.012, 0.012, 0.013), boot);
  let bottom = 1.0 - smoothstep(-1.15, -0.95, obj.y);
  col = mix(col, vec3<f32>(0.18, 0.03, 0.025), bottom);

  var s: Surf;
  s.albedo = col;
  s.rough = 0.62;
  s.metal = 0.0;
  s.ao = mix(0.5, 1.0, smoothstep(-0.2, 3.0, obj.y));
  return s;
}

fn deck_surface(obj: vec3<f32>) -> Surf {
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
  col *= 1.0 - 0.42 * max(seam, butt);
  var s: Surf;
  s.albedo = col;
  s.rough = 0.8;
  s.metal = 0.0;
  s.ao = 0.85;
  return s;
}

fn steel_surface(obj: vec3<f32>, n: vec3<f32>, base: vec3<f32>, plate: vec2<f32>) -> Surf {
  let pl = plating(obj, n, plate);
  var s: Surf;
  s.albedo = base * (0.94 + 0.12 * pl.y) * (1.0 - 0.16 * pl.x);
  s.rough = 0.6;
  s.metal = 0.0;
  s.ao = 1.0;
  return s;
}

fn surface(ids: u32, aux: u32, obj: vec3<f32>, n: vec3<f32>) -> Surf {
  let mid = (ids >> 8u) & 0xffu;
  var s: Surf;
  s.albedo = vec3<f32>(0.3);
  s.rough = 0.6;
  s.metal = 0.0;
  s.ao = 1.0;
  switch (mid) {
    case M_HULL: {
      s = hull_surface(obj, n);
    }
    case M_DECK: {
      s = deck_surface(obj);
    }
    case M_SUPER: {
      s = steel_surface(obj, n, ship.super_grey.rgb, vec2<f32>(2.4, 1.2));
    }
    case M_TURRET: {
      s = steel_surface(obj, n, ship.hull_grey.rgb * 0.9, vec2<f32>(1.9, 1.0));
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
  let v = normalize(-in.rel);
  var n = normalize(in.nrm);
  if (dot(n, v) < 0.0) {
    n = -n; // thin sheets (decks, plates) are lit from both sides
  }
  var s = surface(in.ids, in.aux, in.obj, in.nrm_obj);

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

  col = apply_haze(col, in.rel);
  return vec4<f32>(col, 1.0);
}
