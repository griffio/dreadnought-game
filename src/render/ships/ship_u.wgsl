// Per-ship uniform. The node table holds node-space -> ship-space matrices (see ShipRig).
struct ShipU {
  model: mat4x4<f32>,                // ship space -> camera-relative world
  nodes: array<mat4x4<f32>, 96>,     // node space -> ship space
  hull_grey: vec4<f32>,              // rgb hull paint
  super_grey: vec4<f32>,             // rgb upperworks paint
  misc: vec4<f32>,                   // x wetness, y concrete (a fort: the deck is poured concrete), z cutaway radius (m; 0 = none), w unused
  clock: vec4<f32>,                  // x simulation time (s), y weathering 0..1, z how many decals she carries
  decals: array<vec4<f32>, 96>,      // 32 decals of three vec4s: (pos.xyz, radius), (normal.xyz, kind), (created, seed, 0, 0)
};
