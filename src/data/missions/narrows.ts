import { GUN_15_40_COAST, GUN_24_HOWITZER, GUN_30_COAST } from '../../sim/gunnery/guns';
import { RANGEFINDER_9FT } from '../../sim/gunnery/rangefinder';
import type { FortSpec } from '../../sim/fort/fort';
import { MineField } from '../../sim/mines/mines';
import { buildTerrain, type TerrainSpec } from '../../sim/terrain/generate';
import type { Terrain } from '../../sim/terrain/terrain';

/**
 * The Narrows: a strait between two hilly coasts, two kilometres across at its throat. The ship comes up from the south. An
 * island battery guards the approach, two forts on the promontories command the throat, a howitzer battery hides behind the ridge
 * on the east shore and fires on what its observer sees from the crest, and two lines of mines (each with a swept lane the chart
 * does not show) lie across the water. Shoals make the channel narrower than it looks.
 *
 * World axes: x east, z south. The player starts at the bottom and steams north (heading 0 is toward -z).
 */
export const NARROWS_TERRAIN: TerrainSpec = {
  x0: -7000,
  z0: -10000,
  width: 14000,
  length: 17000,
  cell: 20,
  seabed: 62,
  masses: [
    // The two mainland coasts.
    { x: -6500, z: -2500, rx: 5000, rz: 9500, peak: 200, rough: 0.8, profile: 0.4 },
    { x: 6800, z: -3500, rx: 5300, rz: 9500, peak: 190, rough: 0.8, profile: 0.4 },
    // The promontories at the throat.
    { x: -1900, z: -2650, rx: 900, rz: 1300, peak: 85, rough: 0.4, shelf: 300, profile: 0.6 },
    { x: 1700, z: -1700, rx: 800, rz: 1100, peak: 62, rough: 0.4, shelf: 300, profile: 0.6 },
    // The ridge on the east shore, with the guns hidden behind it.
    { x: 3300, z: -2300, rx: 800, rz: 3000, peak: 215, rough: 0.5, profile: 0.7 },
    // The island in the southern approach.
    { x: -250, z: 2200, rx: 500, rz: 750, peak: 55, rough: 0.4, shelf: 250, profile: 0.7 },
  ],
  banks: [
    { x: -700, z: -300, rx: 380, rz: 900, depth: 6.5 },
    { x: 700, z: 2400, rx: 350, rz: 700, depth: 7 },
    { x: 1100, z: -900, rx: 300, rz: 500, depth: 7 },
  ],
};

export const NARROWS_START = { x: 0, z: 8800, headingDeg: 0 } as const;

export function narrowsFortSpecs(): FortSpec[] {
  return [
    {
      id: 'island',
      name: 'Island Battery',
      x: -250,
      z: 2150,
      gun: GUN_15_40_COAST,
      rangefinder: RANGEFINDER_9FT,
      skill: { rangefinderError: 1.2, dispersion: 1.15 },
      eye: 10,
      ammunition: 220,
      emplacements: [
        { id: 'I1', dx: -42, dz: 6, frontMm: 25, roofMm: 12, radius: 7, height: 1.8 },
        { id: 'I2', dx: -14, dz: -14, frontMm: 25, roofMm: 12, radius: 7, height: 1.8 },
        { id: 'I3', dx: 14, dz: 4, frontMm: 25, roofMm: 12, radius: 7, height: 1.8 },
        { id: 'I4', dx: 42, dz: -8, frontMm: 25, roofMm: 12, radius: 7, height: 1.8 },
      ],
    },
    {
      id: 'west',
      name: 'West Fort',
      x: -2000,
      z: -2650,
      gun: GUN_15_40_COAST,
      rangefinder: RANGEFINDER_9FT,
      skill: { rangefinderError: 1.1, dispersion: 1.1 },
      eye: 14,
      ammunition: 240,
      emplacements: [
        { id: 'W1', dx: -27, dz: 7, frontMm: 210, roofMm: 170, radius: 6, height: 4, arc: { centreDeg: 85, halfDeg: 80 } },
        { id: 'W2', dx: -9, dz: 2, frontMm: 210, roofMm: 170, radius: 6, height: 4, arc: { centreDeg: 85, halfDeg: 80 } },
        { id: 'W3', dx: 9, dz: -2, frontMm: 210, roofMm: 170, radius: 6, height: 4, arc: { centreDeg: 85, halfDeg: 80 } },
        { id: 'W4', dx: 27, dz: -7, frontMm: 210, roofMm: 170, radius: 6, height: 4, arc: { centreDeg: 85, halfDeg: 80 } },
        { id: 'W5', dx: 45, dz: -12, frontMm: 210, roofMm: 170, radius: 6, height: 4, arc: { centreDeg: 85, halfDeg: 80 } },
      ],
    },
    {
      id: 'east',
      name: 'East Fort',
      x: 1750,
      z: -1800,
      gun: GUN_30_COAST,
      rangefinder: RANGEFINDER_9FT,
      skill: { rangefinderError: 1, dispersion: 1 },
      eye: 16,
      ammunition: 120,
      emplacements: [
        { id: 'E1', dx: -30, dz: 4, frontMm: 300, roofMm: 150, radius: 8, height: 5 },
        { id: 'E2', dx: 0, dz: -3, frontMm: 300, roofMm: 150, radius: 8, height: 5 },
        { id: 'E3', dx: 30, dz: 2, frontMm: 300, roofMm: 150, radius: 8, height: 5 },
      ],
    },
    {
      id: 'howitzers',
      name: 'Ridge Howitzers',
      x: 4300,
      z: -2300,
      gun: GUN_24_HOWITZER,
      rangefinder: RANGEFINDER_9FT,
      skill: { rangefinderError: 1.2, dispersion: 1.1 },
      eye: 4,
      // They cannot see the strait from their pits: the observation post on the crest of the ridge can.
      observer: { x: 3300, z: -2300, eye: 8 },
      hidden: true,
      ammunition: 150,
      emplacements: [
        { id: 'H1', dx: -26, dz: 3, frontMm: 0, roofMm: 0, radius: 6, height: 1.6 },
        { id: 'H2', dx: -9, dz: -2, frontMm: 0, roofMm: 0, radius: 6, height: 1.6 },
        { id: 'H3', dx: 9, dz: 2, frontMm: 0, roofMm: 0, radius: 6, height: 1.6 },
        { id: 'H4', dx: 26, dz: -3, frontMm: 0, roofMm: 0, radius: 6, height: 1.6 },
      ],
    },
  ];
}

/** The two lines of mines across the water, each with a lane left through it. */
export function narrowsMines(): MineField {
  const field = new MineField();
  field.addLine(-1000, -600, 1000, -600, 140, [1100, 1300]);
  field.addLine(-1300, -3700, 1300, -3700, 150, [700, 900]);
  return field;
}

export function narrowsTerrain(seed = 7): Terrain {
  const terrain = buildTerrain(NARROWS_TERRAIN, seed);
  // The gun sites are levelled into the hillside, and so are the lookout posts.
  for (const f of narrowsFortSpecs()) {
    terrain.flatten(f.x, f.z, 52, 45);
    if (f.observer) terrain.flatten(f.observer.x, f.observer.z, 8, 25);
  }
  return terrain;
}
