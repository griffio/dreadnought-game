import { describe, expect, it } from 'vitest';
import { DAZZLE_SEED, MARKINGS } from '../src/data/ships/markings';
import { ROSTER, type ShipId } from '../src/data/ships/roster';
import { buildShip } from '../src/render/ships/forge/build-ship';
import { flagStreaming, rippleAt } from '../src/render/ships/flags';
import { glyphIndex, glyphsOf, GLYPH_COUNT, hullNumberPlacement, MARK_FLOATS, MARK_NODES, packMarks } from '../src/render/ships/marks';
import { ShipRig } from '../src/render/ships/rig';
import { ReplayRecorder, viewAt, type ShipShot } from '../src/app/replay';

const DEG = Math.PI / 180;
const ids = Object.keys(ROSTER) as ShipId[];

describe('glyphs', () => {
  it('number the digits, then the letters, case alike, and know nothing of anything else', () => {
    expect(glyphIndex('0')).toBe(0);
    expect(glyphIndex('9')).toBe(9);
    expect(glyphIndex('A')).toBe(10);
    expect(glyphIndex('a')).toBe(10);
    expect(glyphIndex('Z')).toBe(GLYPH_COUNT - 1);
    expect(glyphIndex(' ')).toBe(-1);
    expect(glyphIndex('-')).toBe(-1);
  });

  it('make up a text, skipping spaces and what has no glyph, at most four', () => {
    expect(glyphsOf('29')).toEqual([2, 9]);
    expect(glyphsOf('H 04')).toEqual([17, 0, 4]);
    expect(glyphsOf('S144')).toEqual([28, 1, 4, 4]);
    expect(glyphsOf('12345')).toEqual([1, 2, 3, 4]);
    expect(glyphsOf('')).toEqual([]);
  });
});

describe('what each ship wears', () => {
  it('is listed for every ship, with a dazzle pattern of her own', () => {
    for (const id of ids) {
      expect(MARKINGS[id], id).toBeDefined();
      expect(MARKINGS[id].ensign, id).toBeDefined();
      expect(DAZZLE_SEED[id], id).toBeGreaterThan(0);
    }
    // (A ship's two states, whole and wounded, are the same ship.)
    const seeds = ids.filter((id) => id !== 'bismarck-wounded').map((id) => DAZZLE_SEED[id]);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('has a hull number only where it can be painted, and no more than the glyphs hold', () => {
    for (const id of ids) {
      const n = MARKINGS[id].hullNumber;
      if (n === undefined) continue;
      expect(glyphsOf(n, 8).length, id).toBe([...n].filter((c) => c !== ' ').length);
      expect(glyphsOf(n, 8).length, id).toBeLessThanOrEqual(4);
    }
  });

  it('flies the right ensign: white for the Royal Navy, and the German navy’s for the Germans', () => {
    for (const id of ['dreadnought', 'queen-elizabeth', 'rodney', 'king-george-v'] as const) expect(MARKINGS[id].ensign).toBe('white');
    for (const id of ['hessen', 'kaiser', 'destroyer'] as const) expect(MARKINGS[id].ensign).toBe('imperial');
    for (const id of ['bismarck', 'bismarck-wounded'] as const) expect(MARKINGS[id].ensign).toBe('reich');
  });
});

describe('packed for the shader', () => {
  it('places a hull number on the bow, ahead of amidships and under the deck edge', () => {
    const model = buildShip(ROSTER.rodney.spec);
    const out = packMarks(model, MARKINGS.rodney);
    expect(out).toHaveLength(MARK_FLOATS);
    const [x, y, h, count] = out;
    expect(count).toBe(2);
    expect(x).toBeGreaterThan(model.length * 0.25);
    expect(x).toBeLessThan(model.length / 2);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(model.deckHeightAt(x!));
    expect(h).toBeGreaterThan(1);
    expect(h).toBeLessThanOrEqual(2.8);
    expect(Array.from(out.subarray(4, 6))).toEqual([2, 9]);
  });

  it('puts the letter of each main turret on its own node, and none on the light guns', () => {
    const model = buildShip(ROSTER['queen-elizabeth'].spec);
    const out = packMarks(model, MARKINGS['queen-elizabeth']);
    let lettered = 0;
    for (const t of model.turrets) {
      const o = 8 + t.houseNode * 8;
      if (/^[A-Z]$/.test(t.id)) {
        lettered++;
        expect(out[o], t.id).toBe(glyphIndex(t.id) + 1);
        // On the side of the house, at its middle and half way up, and on the roof.
        expect(out[o + 1]).toBeGreaterThan(0.5);
        expect(out[o + 2]).toBeCloseTo(t.house.cx, 5);
        expect(out[o + 3]).toBeCloseTo(t.house.sideY, 5);
        expect(out[o + 6]).toBeCloseTo(t.house.roofY, 5);
      } else {
        expect(out[o], t.id).toBe(0);
      }
    }
    expect(lettered).toBe(4);
  });

  it('is empty for a ship that wears nothing, and for the German ships\' turrets', () => {
    const model = buildShip(ROSTER.kaiser.spec);
    expect(packMarks(model, undefined).every((v) => v === 0)).toBe(true);
    const out = packMarks(model, MARKINGS.kaiser);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('keeps every node inside the table', () => {
    for (const id of ids) {
      const model = buildShip(ROSTER[id].spec);
      for (const t of model.turrets) expect(t.houseNode).toBeLessThan(MARK_NODES);
    }
  });

  it('places a bigger hull number on a ship with a higher side', () => {
    expect(hullNumberPlacement(200, 9).height).toBeGreaterThan(hullNumberPlacement(80, 3).height);
    expect(hullNumberPlacement(80, 1).height).toBeGreaterThanOrEqual(1);
  });
});

describe('flags', () => {
  it('hang from the staff aft and the gaff of the aftermost mast', () => {
    for (const id of ids) {
      const model = buildShip(ROSTER[id].spec);
      expect(model.flags.length, id).toBe(2);
      const [ensign, battle] = model.flags.map((n) => model.nodes[n]!);
      // The ensign is at the stern, the staff's top; the battle ensign is higher up, on the mast.
      expect(ensign!.name).toBe('flag-ensign');
      expect(ensign!.pivot[0]).toBeLessThan(-model.length * 0.3);
      expect(battle!.name).toBe('flag-battle');
      expect(battle!.pivot[1]).toBeGreaterThan(ensign!.pivot[1]);
    }
  });

  it('stream along the wind: aft when she steams in a calm, and to leeward when she is stopped', () => {
    const calm = flagStreaming(0, 12, 70, 0);
    expect(Math.abs(Math.abs(calm.angle) - Math.PI)).toBeLessThan(1e-9);
    expect(calm.speed).toBeCloseTo(12, 9);
    // Stopped, heading north, with the wind blowing toward the east: the flags stream to starboard.
    const east = flagStreaming(0, 0, 90, 10);
    expect(east.angle).toBeCloseTo(Math.PI / 2, 9);
    // And toward the west, to port.
    expect(flagStreaming(0, 0, 270, 10).angle).toBeCloseTo(-Math.PI / 2, 9);
    // Blowing from astern at her own speed, the air is still on her: no wind to speak of.
    expect(flagStreaming(0, 10, 0, 10).speed).toBeCloseTo(0, 9);
    // The ship's heading turns the picture: the same wind, on a ship heading east, streams the flags astern.
    expect(Math.abs(Math.abs(flagStreaming(90, 0, 90, 10).angle) - 0)).toBeLessThan(1e-9);
  });

  it('ripple more in a stronger wind, and never hang quite dead', () => {
    expect(rippleAt(0)).toBe(0.2);
    expect(rippleAt(5)).toBeLessThan(rippleAt(10));
    expect(rippleAt(50)).toBe(1);
  });

  it('are swung by the rig to stream along a direction, and hauled down to nothing', () => {
    const model = buildShip(ROSTER['queen-elizabeth'].spec);
    const rig = new ShipRig(model);
    rig.update();
    const rest = Array.from(rig.matrices.subarray(model.flags[0]! * 16, model.flags[0]! * 16 + 16));
    // Streaming straight aft is how it was built: no change.
    rig.setFlags(Math.PI);
    rig.update();
    expect(Array.from(rig.matrices.subarray(model.flags[0]! * 16, model.flags[0]! * 16 + 16))).toEqual(rest);
    // Swung to starboard, it moves.
    rig.setFlags(90 * DEG);
    rig.update();
    const swung = Array.from(rig.matrices.subarray(model.flags[0]! * 16, model.flags[0]! * 16 + 16));
    expect(swung).not.toEqual(rest);
    // Hauled down, every flag is squashed to a point and nothing of it is drawn.
    rig.hauledDown(true);
    rig.update();
    expect(rig.coloursDown).toBe(true);
    for (const n of model.flags) {
      const m = Array.from(rig.matrices.subarray(n * 16, n * 16 + 16));
      expect(m.every((v, i) => (i === 15 ? v === 1 : v === 0))).toBe(true);
    }
    // Run up again, they are back.
    rig.hauledDown(false);
    rig.update();
    expect(Array.from(rig.matrices.subarray(model.flags[0]! * 16, model.flags[0]! * 16 + 16))).toEqual(swung);
  });
});

describe('a replay of the colours', () => {
  const shot = (extra: Partial<ShipShot>): ShipShot => ({ x: 0, z: 0, headingDeg: 0, heave: 0, pitch: 0, roll: 0, speed: 0, power: 0, visible: true, guns: new Float32Array(0), ...extra });

  it('shows them up before she struck and down after', () => {
    const rec = new ReplayRecorder();
    [shot({}), shot({}), shot({ coloursDown: true }), shot({ coloursDown: true })].forEach((s, i) => rec.sample({ t: i / 30, sea: i / 30, ships: [s], shells: [] }));
    expect(viewAt(rec, 0)!.ships[0]!.coloursDown).toBeUndefined();
    expect(viewAt(rec, 3 / 30)!.ships[0]!.coloursDown).toBe(true);
  });
});
