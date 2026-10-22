// Per-ship uniform. The node table holds node-space -> ship-space matrices (see ShipRig).
struct ShipU {
  model: mat4x4<f32>,                // ship space -> camera-relative world
  nodes: array<mat4x4<f32>, 96>,     // node space -> ship space
  hull_grey: vec4<f32>,              // rgb hull paint
  super_grey: vec4<f32>,             // rgb upperworks paint
  misc: vec4<f32>,                   // x wetness, y concrete (a fort: the deck is poured concrete), z cutaway radius (m; 0 = none), w dazzle pattern seed (0 = her Admiralty paint)
  clock: vec4<f32>,                  // x simulation time (s), y weathering 0..1, z how many decals she carries, w how many fires burn in her
  decals: array<vec4<f32>, 96>,      // 32 decals of three vec4s: (pos.xyz, radius), (normal.xyz, kind), (created, seed, 0, 0)
  node_char: array<vec4<f32>, 24>,   // how charred each of the 96 nodes is, 0..1, four to a vec4
  fires: array<vec4<f32>, 8>,        // the fires burning in her: (ship-space position, intensity 0..1)
  split: vec4<f32>,                  // a ship broken in two: x where (ship space), y which part is shown (+1 forward of the break, -1 aft, 0 none), z how ragged the break is (m), w seconds since it broke
  marks: vec4<f32>,                  // her hull number: x, y (ship space), glyph height (m), how many glyphs
  mark_glyphs: vec4<f32>,            // its glyphs, as cells of the glyph atlas
  node_mark: array<vec4<f32>, 192>,  // two per node: (letter glyph + 1, or 0 for none; side height; house x; side y), (house z; roof height; roof y; 0)
  flags: vec4<f32>,                  // her flags: x how hard they ripple 0..1, y unused, z which ensign (0 white, 1 imperial German, 2 Kriegsmarine), w a nominal flag length (m)
};
