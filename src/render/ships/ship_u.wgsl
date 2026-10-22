// Per-ship uniform. The node table holds node-space -> ship-space matrices (see ShipRig).
struct ShipU {
  model: mat4x4<f32>,                // ship space -> camera-relative world
  nodes: array<mat4x4<f32>, 96>,     // node space -> ship space
  hull_grey: vec4<f32>,              // rgb hull paint
  super_grey: vec4<f32>,             // rgb upperworks paint
  misc: vec4<f32>,                   // x wetness, y concrete (a fort: the deck is poured concrete), z unused, w unused
};
