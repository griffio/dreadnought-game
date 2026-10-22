import type { ShipModel } from './forge/spec';

/** The flags a navy flies at the ensign staff and the masthead. */
export type EnsignKind = 'white' | 'imperial' | 'reich';

/** The ensigns as the shader numbers them. */
export const ENSIGN_CODE: Record<EnsignKind, number> = { white: 0, imperial: 1, reich: 2 };

/** What is painted and flown on a ship besides her colours: all of it drawn by the ship shader and the Forge's flags. */
export interface ShipMarkings {
  /** Painted on both sides of her bow, in white ("41"; letters too: "H 04"). */
  hullNumber?: string;
  /** The letters of her main turrets, painted on the roofs and sides of the houses (A, B, X, Y...). */
  turretLetters?: boolean;
  /** The ensign she flies. */
  ensign?: EnsignKind;
  /** The seed of a dazzle pattern (0 or none: her Admiralty paint). */
  dazzle?: number;
}

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GLYPH_COLS = 6;
export const GLYPH_COUNT = CHARS.length;

/** Where a character is in the glyph atlas (digits, then A to Z), or -1 when it has no glyph. */
export function glyphIndex(ch: string): number {
  return CHARS.indexOf(ch.toUpperCase());
}

/** The atlas cells of a text (spaces and anything without a glyph are skipped), at most `max` of them. */
export function glyphsOf(text: string, max = 4): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const i = glyphIndex(ch);
    if (i >= 0 && out.length < max) out.push(i);
  }
  return out;
}

/** The most turret/node slots the marks table holds (two vec4 each): the rig's nodes. */
export const MARK_NODES = 96;
/** Floats in the packed marks: the hull number (two vec4) and two vec4 for each node. */
export const MARK_FLOATS = 8 + MARK_NODES * 8;

/** Where a ship's hull number goes: ahead of amidships on the bow, a little under her deck edge, and as tall as her side allows. */
export function hullNumberPlacement(length: number, deckAtBow: number): { x: number; y: number; height: number } {
  return { x: 0.33 * length, y: deckAtBow * 0.52, height: Math.min(Math.max(deckAtBow * 0.42, 1.0), 2.8) };
}

/**
 * Pack a ship's markings for the shader: the hull number's place and glyphs, and for each turret node the glyph of its letter and where
 * it goes. Layout: [0..3] x, y, glyph height, count; [4..7] the glyphs; then per node two vec4: (glyph + 1 or 0 for none, side height,
 * house middle x, side y) and (house middle z, roof height, roof y, 0).
 */
export function packMarks(model: ShipModel, markings: ShipMarkings | undefined, out: Float32Array = new Float32Array(MARK_FLOATS)): Float32Array {
  out.fill(0);
  const m = markings;
  if (!m) return out;
  const number = m.hullNumber ? glyphsOf(m.hullNumber) : [];
  if (number.length > 0) {
    const bow = hullNumberPlacement(model.length, model.deckHeightAt(0.33 * model.length));
    out.set([bow.x, bow.y, bow.height, number.length], 0);
    out.set(number, 4);
  }
  if (m.turretLetters) {
    for (const t of model.turrets) {
      // Only the main turrets, which are lettered A, B, C... : the light guns' ids are not.
      if (!/^[A-Z]$/.test(t.id) || t.houseNode >= MARK_NODES) continue;
      const o = 8 + t.houseNode * 8;
      const h = t.house;
      const side = Math.min(h.width * 0.34, 2.6);
      const roof = Math.min(h.width * 0.62, 5.2);
      out.set([glyphIndex(t.id) + 1, side, h.cx, h.sideY, h.cz, roof, h.roofY, 0], o);
    }
  }
  return out;
}
