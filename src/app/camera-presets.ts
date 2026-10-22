/** Camera positions in ship space (x forward, y up, z starboard) with the point to look at. Showcase (?free=1). */
export const CAMERA_PRESETS: { name: string; at: [number, number, number]; look: [number, number, number] }[] = [
  { name: 'Bow quarter', at: [92, 20, 68], look: [12, 9, 0] },
  { name: 'Beam', at: [0, 15, 130], look: [0, 9, 0] },
  { name: 'Stern quarter', at: [-100, 20, -62], look: [0, 9, 0] },
  { name: 'Bridge', at: [24, 19, 0], look: [78, 5, 0] },
  { name: 'Forward turret', at: [76, 10.5, 17], look: [56, 7, 0] },
  { name: 'Low', at: [50, 4.5, 50], look: [34, 8.5, 0] },
];

/** Ship space to world for a ship at the origin heading north (ship +x = world -z, ship +z = world +x). */
export function shipToWorld(p: [number, number, number]): [number, number, number] {
  return [p[2], p[1], -p[0]];
}
