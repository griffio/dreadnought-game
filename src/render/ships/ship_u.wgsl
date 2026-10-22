// Per-ship uniform. The node table holds node-space -> ship-space matrices (see ShipRig).
struct ShipU {
  model: mat4x4<f32>,                // ship space -> camera-relative world
  nodes: array<mat4x4<f32>, 96>,     // node space -> ship space
  hull_grey: vec4<f32>,              // rgb hull paint
  super_grey: vec4<f32>,             // rgb upperworks paint
  misc: vec4<f32>,                   // x wetness, y concrete (a fort: the deck is poured concrete), z cutaway radius (m; 0 = none), w unused
  clock: vec4<f32>,                  // x simulation time (s), y weathering 0..1, z how many decals she carries, w how many fires burn in her
  decals: array<vec4<f32>, 96>,      // 32 decals of three vec4s: (pos.xyz, radius), (normal.xyz, kind), (created, seed, 0, 0)
  node_char: array<vec4<f32>, 24>,   // how charred each of the 96 nodes is, 0..1, four to a vec4
  fires: array<vec4<f32>, 8>,        // the fires burning in her: (ship-space position, intensity 0..1)
  split: vec4<f32>,                  // a ship broken in two: x where (ship space), y which part is shown (+1 forward of the break, -1 aft, 0 none), z how ragged the break is (m), w seconds since it broke
};
