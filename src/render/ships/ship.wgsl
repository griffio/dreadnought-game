// Ship pipeline: one draw per ship. Vertices carry an animation node and a material id; node matrices live in a
// uniform table. Surfaces are procedural: plating seams, deck planks, boot-topping, weathering.
// Requires common, scene, sky_map, env, haze, shadow, ship_u. Group 2 = ship instance.
const EARTH_R: f32 = 6371000.0;
const M_FLAG: u32 = 10u;
// Whether the shader may leave a pixel out (the sight's cutaway, a ship broken in two). A shader that can discard cannot have its hidden
// surfaces removed before shading on a tile-based GPU, and a ship is drawn double-sided, so the ordinary pipeline is made without it: only a
// ship's works (not her hull and decks, which are the pixels), and only when one of those needs it, are drawn with the pipeline that has it.
override use_discard: bool = true;

@group(2) @binding(0) var<uniform> ship: ShipU;

struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) ids: u32,
  @location(3) aux: u32,
};

struct VOut {
  // (Invariant: the depth pre-pass and the colour pass of a ship's works must agree on every pixel's depth to the last bit.)
  @builtin(position) @invariant clip: vec4<f32>,
  @location(0) rel: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) obj: vec3<f32>,
  @location(3) nrm_obj: vec3<f32>,
  @location(4) @interpolate(flat) ids: u32,
  @location(5) @interpolate(flat) aux: u32,
  @location(6) uv: vec2<f32>,
};

@vertex
fn vs(in: VIn) -> VOut {
  let nm = ship.nodes[in.ids & 0xffu];
  var pos = in.pos;
  var nrm = in.nrm;
  var cloth = vec2<f32>(0.0);
  // A flag ripples: waves run down the cloth from the hoist, growing toward the fly, in the node's own frame (so it ripples across
  // whichever way the rig has swung it).
  if (((in.ids >> 8u) & 0xffu) == M_FLAG) {
    let u = f32(in.aux & 0xffu) / 255.0;
    let v = f32((in.aux >> 8u) & 0xffu) / 255.0;
    cloth = vec2<f32>(u, v);
    let amp = ship.flags.x * ship.flags.w;
    let t = ship.clock.x * 6.0 + f32(in.ids & 0xffu) * 1.7;
    let k1 = u * 7.0 - t + v * 1.3;
    let k2 = u * 13.0 - t * 1.7 + v * 2.1;
    let wave = 0.15 * sin(k1) + 0.06 * sin(k2);
    pos = in.pos + vec3<f32>(0.0, amp * u * 0.02 * sin(u * 9.0 - t * 1.1), amp * u * wave);
    nrm = normalize(vec3<f32>(ship.flags.x * (wave + u * (1.05 * cos(k1) + 0.78 * cos(k2))), 0.0, 1.0));
  }
  // A ship broken in two: her hull and decks (the sheets that cover most of her pixels) are cut here, not in the fragment shader, which would
  // have to discard (see `use_discard`): what lies on the far side of the break is laid along it, a vertex at a time, and the wobble in where
  // that is makes the torn edge zig-zag. Her works (turrets, funnels, masts) are cut in the fragment shader, along the same line.
  if (ship.split.y != 0.0 && ((in.ids >> 8u) & 0xffu) <= M_DECK) {
    let cut = ship.split.x + (value_noise(vec2<f32>(in.pos.y * 0.5 + in.pos.z * 0.37, in.pos.z * 0.8 - in.pos.y * 0.21)) - 0.5) * 2.0 * ship.split.z;
    if ((in.pos.x - cut) * ship.split.y < 0.0) {
      pos.x = cut;
    }
  }
  let p_ship = nm * vec4<f32>(pos, 1.0);
  let n_ship = (nm * vec4<f32>(nrm, 0.0)).xyz;
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
  out.uv = cloth;
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
@group(1) @binding(6) var glyph_tex: texture_2d<f32>;
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

// Dazzle: the angular patches of black, white and greys and blues that broke up a ship's lines from 1917, so that her speed and heading were
// hard to judge. Laid out in ship space: her sides are cut into blocks along her length, each block crossed by stripes at its own angle and
// width, and a second cut across them makes the wedges. Hard edged; `seed` makes each ship's pattern her own.
fn dazzle_colour(obj: vec3<f32>, n: vec3<f32>, seed: f32) -> vec3<f32> {
  let along = select(obj.x, obj.z, abs(n.x) > 0.6);
  let y = obj.y;
  let blk = floor(along / 17.0 + seed * 0.37);
  let h1 = hash21(vec2<f32>(blk, seed));
  let h2 = hash21(vec2<f32>(blk + 7.0, seed * 1.7));
  let ang = (h1 - 0.5) * 2.5;
  let width = 2.4 + 3.4 * h2;
  let k = floor((along * sin(ang) + y * cos(ang)) / width);
  let cut = ang * 1.7 + 0.6;
  let k2 = floor((along * cos(cut) - y * sin(cut)) / (width * 2.3));
  let first = hash21(vec2<f32>(k + blk * 3.1, seed + 11.0));
  let second = hash21(vec2<f32>(k2 + 5.0, blk + seed));
  let p = select(first, second, hash21(vec2<f32>(k, k2 + blk)) > 0.55);
  if (p < 0.28) { return vec3<f32>(0.012, 0.012, 0.014); }
  if (p < 0.52) { return vec3<f32>(0.50, 0.51, 0.52); }
  if (p < 0.70) { return vec3<f32>(0.20, 0.215, 0.23); }
  if (p < 0.86) { return vec3<f32>(0.04, 0.055, 0.085); }
  return vec3<f32>(0.12, 0.19, 0.27);
}

// The Kriegsmarine's Baltic scheme of 1941, as Bismarck wore it in the Baltic and on her way north: the hull's ends painted dark grey
// with a white false bow wave and stern wave to make her look shorter, and two chevrons of black and white stripes across her sides,
// forward and aft of the superstructure, to confuse her heading. Hull sides only; decks and works stay grey. `len` is her length.
fn baltic_colour(obj: vec3<f32>, n: vec3<f32>, base: vec3<f32>, seed: f32, len: f32) -> vec3<f32> {
  if (abs(n.y) > 0.5) { return base; }
  let ax = abs(obj.x);
  let y = obj.y;
  let half = len * 0.5;
  let endFrom = len * 0.33;
  let dark = vec3<f32>(0.10, 0.105, 0.115);
  let white = vec3<f32>(0.82, 0.82, 0.80);
  let black = vec3<f32>(0.012, 0.012, 0.014);
  // The ends: dark, with the false wave rising toward the stem and the stern post.
  if (ax > endFrom) {
    let t = clamp((ax - endFrom) / max(half - endFrom, 1.0), 0.0, 1.0);
    let crest = 0.6 + 3.4 * t * t;
    let wave = step(-0.5, y) * step(y, crest);
    return mix(dark, white, wave);
  }
  // The stripes: a forward chevron and an after one, each sloping toward the bow at the top.
  let fore = obj.x > 0.0;
  let startAt = select(len * 0.14, len * 0.11, fore);
  if (ax < startAt) { return base; }
  let u = select(-obj.x - y, obj.x - y, fore);
  let k = floor(u / 5.5 + seed * 0.37);
  let odd = k - 2.0 * floor(k * 0.5);
  return select(black, white, odd > 0.5);
}

fn hull_surface(obj: vec3<f32>, n: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  // (`ship.flags.y` is the survey's ladder of how much of the ship's finish is drawn: 0 all of it, then the damage and lettering off at
  // 1, the weathering pictures at 2, the noise and plating at 3, the shadow lookups at 4, and the reflections and haze at 5.)
  let ladder = ship.flags.y;
  var pl = vec2<f32>(0.0, 0.5);
  if (ladder < 2.5) {
    pl = plating(obj, n, vec2<f32>(3.1, 1.55));
  }
  var col = ship.hull_grey.rgb * (0.93 + 0.14 * pl.y);
  // misc.w is the dazzle seed: positive the Royal Navy's patches, negative the Baltic scheme, zero her plain paint.
  if (ship.misc.w > 0.0) {
    col = mix(col, dazzle_colour(obj, n, ship.misc.w) * (0.93 + 0.14 * pl.y), smoothstep(-0.7, -0.3, obj.y));
  } else if (ship.misc.w < 0.0) {
    let painted = baltic_colour(obj, n, ship.hull_grey.rgb, -ship.misc.w, ship.flags.w / 0.0242);
    col = mix(col, painted * (0.93 + 0.14 * pl.y), smoothstep(-0.7, -0.3, obj.y));
  }
  col *= 1.0 - 0.15 * pl.x;

  // Above the waterline: the plating's own detail, then the weathering, in proportion to how long she has been at sea.
  let weathering = ship.clock.y;
  let above = smoothstep(-0.9, -0.4, obj.y);
  var steel = vec4<f32>(0.5, 0.5, 0.0, 0.0);
  var wear = vec4<f32>(0.0);
  var drip = 0.0;
  var grime = 0.0;
  if (ladder < 1.5) {
    steel = tri(L_STEEL, obj, n, 0.2, dx, dy);
    // Paint worn through to rust and bare metal, and lighter chips where it lifts.
    wear = tri(L_WEAR, obj, n, 0.16, dx, dy);
    drip = side_tex(L_STREAK, obj, n, vec2<f32>(0.34, 0.085), dx, dy).r;
    grime = tri(L_GRIME, obj, n, 0.1, dx, dy).r;
  }
  col *= 1.0 + ((steel.r - 0.5) * 0.75 + (steel.g - 0.5) * 0.35) * above;
  // Rust does not fall evenly: it gathers in patches, and more of it low down and under the deck edge.
  let along = select(obj.x, obj.z, abs(n.x) > 0.6);
  var blotch = 0.5;
  if (ladder < 2.5) {
    blotch = smoothstep(0.32, 0.7, fbm(vec2<f32>(along * 0.1, obj.y * 0.2), 3));
  }
  let rust = clamp(wear.r * weathering * above * mix(0.18, 1.0, blotch) * (0.55 + 0.6 * (1.0 - smoothstep(0.5, 6.0, obj.y))), 0.0, 1.0);
  col = mix(col, vec3<f32>(0.16, 0.075, 0.04) * (0.65 + 0.9 * wear.b), rust * 0.85);
  col *= 1.0 + wear.g * weathering * above * 0.35;
  // Rust drips from the deck edge and the scuppers, and grime and soot that gather low.
  col = mix(col, vec3<f32>(0.13, 0.07, 0.045), drip * weathering * 0.62 * smoothstep(0.5, 4.5, obj.y));
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
  var wood = vec4<f32>(0.5, 0.0, 0.0, 0.0);
  var deck_grime = 0.0;
  if (ship.flags.y < 1.5) {
    wood = textureSampleGrad(weather, weather_samp, obj.xz * 0.47, L_WOOD, dx.xz * 0.47, dy.xz * 0.47);
    deck_grime = textureSampleGrad(weather, weather_samp, obj.xz * 0.11, L_GRIME, dx.xz * 0.11, dy.xz * 0.11).r;
  }
  col *= 0.72 + 0.56 * wood.r;
  col *= 1.0 - 0.4 * wood.g;
  col *= 1.0 - 0.16 * seam - 0.3 * butt;
  col *= 1.0 - deck_grime * ship.clock.y * 0.35;
  var s: Surf;
  s.albedo = col;
  s.rough = 0.8;
  s.metal = 0.0;
  s.ao = 0.85;
  return s;
}

fn steel_surface(obj: vec3<f32>, n: vec3<f32>, base: vec3<f32>, plate: vec2<f32>, layer: i32, dx: vec3<f32>, dy: vec3<f32>) -> Surf {
  let ladder = ship.flags.y;
  var pl = vec2<f32>(0.0, 0.5);
  var detail = vec4<f32>(0.5);
  var wear = vec4<f32>(0.0);
  var grime = 0.0;
  if (ladder < 2.5) {
    pl = plating(obj, n, plate);
  }
  if (ladder < 1.5) {
    detail = tri(layer, obj, n, 0.28, dx, dy);
    wear = tri(L_WEAR, obj, n, 0.2, dx, dy);
    grime = tri(L_GRIME, obj, n, 0.13, dx, dy).r;
  }
  let weathering = ship.clock.y;
  var s: Surf;
  var tint = base;
  if (ship.misc.w > 0.0) {
    tint = dazzle_colour(obj, n, ship.misc.w);
  }
  var col = tint * (0.94 + 0.12 * pl.y) * (1.0 - 0.16 * pl.x);
  col *= 1.0 + (detail.r - 0.5) * 0.7;
  var blotch = 0.5;
  if (ladder < 2.5) {
    blotch = smoothstep(0.32, 0.7, fbm(obj.xz * 0.12 + obj.y * 0.17, 3));
  }
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

// A navy's ensign: `u` along the cloth from the hoist, `v` up from the bottom; the flag is twice as long as it is high. Drawn small, as it
// is seen from a long way off: the colours and the cross, with the canton in the corner of the hoist.
fn ensign(kind: i32, u: f32, v: f32) -> vec3<f32> {
  let white = vec3<f32>(0.70, 0.70, 0.68);
  let red = vec3<f32>(0.34, 0.012, 0.016);
  let blue = vec3<f32>(0.008, 0.02, 0.13);
  let black = vec3<f32>(0.012);
  let x = u * 2.0;
  let y = v;
  var c = white;
  if (kind == 0) {
    // The White Ensign: a red cross, and the Union flag in the upper hoist quarter.
    if (x < 1.0 && y > 0.5) {
      let a = x * 2.0 - 1.0;
      let b = (y - 0.75) * 2.0;
      let d1 = abs(b - 0.5 * a) / 1.118;
      let d2 = abs(b + 0.5 * a) / 1.118;
      c = blue;
      if (d1 < 0.085 || d2 < 0.085) { c = white; }
      if (min(d1, d2) < 0.03) { c = red; }
      if (abs(b) < 0.17 || abs(a) < 0.17) { c = white; }
      if (abs(b) < 0.1 || abs(a) < 0.1) { c = red; }
    } else if (abs(x - 1.0) < 0.1 || abs(y - 0.5) < 0.1) {
      c = red;
    }
  } else if (kind == 1) {
    // The Imperial German ensign: a black cross on white, and in the canton the black, white and red of the Reich.
    if (x < 1.0 && y > 0.5) {
      let band = (y - 0.5) * 2.0;
      c = select(select(red, white, band > 0.34), black, band > 0.67);
    } else if (abs(x - 1.0) < 0.085 || abs(y - 0.5) < 0.085) {
      c = black;
    }
  } else {
    // The naval ensign of the Second World War: a red field and a white disc, with a black cross in it. (The emblem that the real flag
    // carries in the disc is not drawn.)
    c = red;
    let q = vec2<f32>(x - 1.0, y - 0.5);
    if (x < 1.0 && y > 0.5) {
      c = white;
      if (abs(x - 0.5) < 0.05 || abs(y - 0.75) < 0.05) { c = black; }
    } else if (length(q) < 0.34) {
      c = white;
      if (abs(q.x) < 0.07 || abs(q.y) < 0.07) { c = black; }
    }
  }
  return c;
}

// ---- lettering: her hull number and the letters of her turrets, painted in white ---------------------------------------------------
const GLYPH_CELL: f32 = 128.0;

// How much of a pixel the glyph `idx` covers at (cu, cv) in its cell (cv up), read from the atlas at a level that suits the pixel's size.
fn glyph_cover(idx: i32, cu: f32, cv: f32, lod: f32) -> f32 {
  let col = f32(idx % 6);
  let row = f32(idx / 6);
  let uv = (vec2<f32>(col, row) + vec2<f32>(clamp(cu, 0.0, 1.0), clamp(1.0 - cv, 0.0, 1.0))) / 6.0;
  let a = textureSampleLevel(glyph_tex, weather_samp, uv, lod).r;
  return smoothstep(0.35, 0.65, a);
}

// The hull number on the bow, read the right way up from each side of her (so it runs toward the bow on her starboard side and toward
// the stern on her port). `footprint` is the metres one pixel covers here.
fn hull_number(obj: vec3<f32>, n: vec3<f32>, footprint: f32) -> f32 {
  let count = i32(ship.marks.w + 0.5);
  if (count == 0 || abs(n.z) < 0.55) {
    return 0.0;
  }
  let h = ship.marks.z;
  let adv = h * 0.78;
  let side = select(-1.0, 1.0, n.z > 0.0);
  let t = side * (obj.x - ship.marks.x) / adv + 0.5 * f32(count);
  let v = (obj.y - ship.marks.y) / h + 0.5;
  if (t < 0.0 || t >= f32(count) || v < 0.0 || v > 1.0) {
    return 0.0;
  }
  let i = i32(floor(t));
  let g = i32(ship.mark_glyphs[i] + 0.5);
  return glyph_cover(g, fract(t), v, log2(max(footprint * GLYPH_CELL / h, 1.0)));
}

// A turret's letter, on both sides of the house and on its roof (where the aircraft and the camera look down on it: its top is toward the guns).
fn turret_letter(node: u32, obj: vec3<f32>, n: vec3<f32>, footprint: f32) -> f32 {
  let a = ship.node_mark[node * 2u];
  if (a.x < 0.5) {
    return 0.0;
  }
  let b = ship.node_mark[node * 2u + 1u];
  let g = i32(a.x + 0.5) - 1;
  var h = a.y;
  var u = 0.0;
  var v = 0.0;
  if (abs(n.z) > 0.7) {
    let side = select(-1.0, 1.0, n.z > 0.0);
    u = side * (obj.x - a.z) / (h * 0.78) + 0.5;
    v = (obj.y - a.w) / h + 0.5;
  } else if (n.y > 0.7 && obj.y > b.z - 0.4) {
    h = b.y;
    u = (obj.z - b.x) / (h * 0.78) + 0.5;
    v = (obj.x - a.z) / h + 0.5;
  } else {
    return 0.0;
  }
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
    return 0.0;
  }
  return glyph_cover(g, u, v, log2(max(footprint * GLYPH_CELL / h, 1.0)));
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

// Has this pixel been cut away: is it within reach of the sight's lens, or on the far side of a ship's break (along the same torn line that
// the vertex shader cuts her hull and decks on)?
fn cut_out(rel: vec3<f32>, obj: vec3<f32>) -> bool {
  if (ship.misc.z > 0.0 && length(rel) < ship.misc.z) {
    return true;
  }
  if (ship.split.y != 0.0) {
    let rag = (value_noise(vec2<f32>(obj.y * 0.5 + obj.z * 0.37, obj.z * 0.8 - obj.y * 0.21)) - 0.5) * 2.0 * ship.split.z;
    if ((obj.x - ship.split.x - rag) * ship.split.y < 0.0) {
      return true;
    }
  }
  return false;
}

// The depth pre-pass of a ship's cuttable works: only what is cut away is left out, and nothing is drawn. The colour pass then shades just
// the pixels that kept their depth, without discarding, so that hidden parts of the works are never shaded.
@fragment
fn fs_depth(in: VOut) -> @location(0) vec4<f32> {
  if (cut_out(in.rel, in.obj)) {
    discard;
  }
  return vec4<f32>(0.0);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  // The position's screen derivatives, taken before anything can leave the pixel early, for the texture lookups below.
  let dpx = dpdx(in.obj);
  let dpy = dpdy(in.obj);
  // The director's sight sits among the legs of the mast and sees out of it: nothing of the ship that close to the lens is drawn.
  if (use_discard && cut_out(in.rel, in.obj)) {
    discard;
  }
  // A ship that has broken in two is drawn as two parts, each cut off along a torn line: the part on the far side of it is not drawn.
  var tear_char = 0.0;
  var tear_heat = 0.0;
  if (ship.split.y != 0.0) {
    let rag = (value_noise(vec2<f32>(in.obj.y * 0.5 + in.obj.z * 0.37, in.obj.z * 0.8 - in.obj.y * 0.21)) - 0.5) * 2.0 * ship.split.z;
    let into = max((in.obj.x - ship.split.x - rag) * ship.split.y, 0.0);
    tear_char = 1.0 - smoothstep(0.0, 3.5, into);
    // The torn edge is red-hot at first, and cools over half a minute.
    tear_heat = (1.0 - smoothstep(0.0, 1.6, into)) * exp(-ship.split.w / 30.0);
  }
  let v = normalize(-in.rel);
  var n = normalize(in.nrm);
  if (dot(n, v) < 0.0) {
    n = -n; // thin sheets (decks, plates) are lit from both sides
  }
  let node = in.ids & 0xffu;
  let material = (in.ids >> 8u) & 0xffu;
  var s: Surf;
  if (material == M_FLAG) {
    // Cloth: matt, and the same pattern on both sides.
    s.albedo = ensign(i32(ship.flags.z + 0.5), in.uv.x, in.uv.y);
    s.rough = 0.92;
    s.metal = 0.0;
    s.ao = 1.0;
    s.emit = vec3<f32>(0.0);
  } else {
    s = surface(in.ids, in.aux, in.obj, in.nrm_obj, dpx, dpy);
  }
  // Her hull number on the bow, and the letters of her turrets, in white paint (worn a little, as the rest of her is).
  var lettering = 0.0;
  let ladder = ship.flags.y;
  if (ladder >= 0.5) {
    // (the survey's ladder: no lettering)
  } else if (node == 0u && material == M_HULL) {
    lettering = hull_number(in.obj, normalize(in.nrm_obj), max(length(dpx), length(dpy)));
  } else if (node != 0u && material == M_TURRET) {
    lettering = turret_letter(node, in.obj, normalize(in.nrm_obj), max(length(dpx), length(dpy)));
  }
  if (lettering > 0.0) {
    s.albedo = mix(s.albedo, vec3<f32>(0.68, 0.68, 0.65) * (1.0 - 0.32 * ship.clock.y), lettering * 0.95);
    s.rough = mix(s.rough, 0.78, lettering);
  }
  if (tear_char > 0.0) {
    s = charred(s, in.obj, tear_char * 0.95);
    s.emit += vec3<f32>(1.0, 0.32, 0.06) * tear_heat * (0.55 + 0.45 * fbm(in.obj.zy * 1.7 + vec2<f32>(ship.clock.x * 0.2, 0.0), 3)) * 1.6;
  }
  // Hits leave their marks on the static hull (node 0), not on a turret, which turns under them.
  if ((in.ids & 0xffu) == 0u && ladder < 0.5) {
    s = with_decals(s, in.obj, normalize(in.nrm_obj), dpx, dpy);
  }

  // A turret that has been wrecked, and anything else burnt, is black, and the odd ember glows in it.
  let burnt = ship.node_char[node >> 2u][node & 3u];
  if (burnt > 0.0 && ladder < 0.5) {
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
  var sh = 1.0;
  if (ladder < 3.5) {
    sh = shadow_factor(in.rel, n);
  }
  let sun = scene.sun_irr.rgb;

  let amb = scene.ambient.rgb * mix(0.35, 1.0, 0.5 + 0.5 * n.y) * s.ao;
  let diffuse_colour = s.albedo * (1.0 - s.metal);
  var col = diffuse_colour * (amb + sun * (nl * sh / PI));

  if (ladder < 4.5) {
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
  }

  col += s.emit / scene.sun_irr.w;
  if (ladder < 0.5) {
    col += fire_glow(in.obj, normalize(in.nrm_obj)) * 0.3 / scene.sun_irr.w;
  }
  if (ladder < 4.5) {
    col = apply_haze(col, in.rel);
  }
  return vec4<f32>(col, 1.0);
}
