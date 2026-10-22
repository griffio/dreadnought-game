/**
 * The ships' weathering and damage pictures: two small atlases (made by tools/process-textures.py, see there for what is in each
 * channel) uploaded as texture arrays with a full set of mip levels. If they cannot be had the ships are drawn without them: the
 * shader is given neutral layers, which change nothing.
 */
export const WEATHER_TILE = 512;
export const WEATHER_LAYERS = 6;
export const DECAL_TILE = 256;
export const DECAL_LAYERS = 3;

/** The glyph atlas: digits and A to Z in six columns of square cells, white on black. */
export const GLYPH_CELL = 128;
const GLYPH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GLYPH_COLS_ = 6;

export interface WeatheringTextures {
  weather: GPUTexture;
  decals: GPUTexture;
  /** The letters and numbers painted on hulls and turrets (see marks.ts for which cell is which). */
  glyphs: GPUTexture;
  sampler: GPUSampler;
}

const USAGE = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;

function make(device: GPUDevice, label: string, size: number, layers: number): GPUTexture {
  return device.createTexture({
    label,
    size: [size, size, layers],
    format: 'rgba8unorm',
    mipLevelCount: Math.floor(Math.log2(size)) + 1,
    usage: USAGE,
  });
}

/** Upload a strip of `layers` squares of `size` (one above the next) into the texture array, with every mip level made by halving. */
async function upload(device: GPUDevice, texture: GPUTexture, url: string, size: number, layers: number): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const blob = await response.blob();
  const mips = Math.floor(Math.log2(size)) + 1;
  for (let layer = 0; layer < layers; layer++) {
    // Raw values, no colour management: the pictures are data.
    const bitmap = await createImageBitmap(blob, 0, layer * size, size, size, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture, mipLevel: 0, origin: [0, 0, layer] }, [size, size]);
    let previous: ImageBitmap | OffscreenCanvas = bitmap;
    for (let level = 1; level < mips; level++) {
      const s = Math.max(size >> level, 1);
      const canvas = new OffscreenCanvas(s, s);
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(previous, 0, 0, s, s);
      device.queue.copyExternalImageToTexture({ source: canvas }, { texture, mipLevel: level, origin: [0, 0, layer] }, [s, s]);
      previous = canvas;
    }
  }
}

/** A one-pixel-per-layer stand-in: `value` in every channel but alpha. Detail at one half and masks at nothing change nothing. */
function stand(device: GPUDevice, label: string, layers: number, value: number): GPUTexture {
  const texture = device.createTexture({ label, size: [1, 1, layers], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const pixel = new Uint8Array([value, value, value, 255]);
  for (let layer = 0; layer < layers; layer++) device.queue.writeTexture({ texture, origin: [0, 0, layer] }, pixel, { bytesPerRow: 4 }, [1, 1, 1]);
  return texture;
}

/**
 * Draw the glyph atlas: each character in a bold sans face, centred in its cell and stretched to fill the middle of it, so that every
 * glyph is as tall as the next and about as wide. Drawn on a canvas, so it takes whatever heavy sans face the device has.
 */
function makeGlyphs(device: GPUDevice): GPUTexture {
  const size = GLYPH_CELL * GLYPH_COLS_;
  const mips = Math.floor(Math.log2(size)) + 1;
  const texture = device.createTexture({ label: 'ship-glyphs', size: [size, size], format: 'rgba8unorm', mipLevelCount: mips, usage: USAGE });
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `700 ${GLYPH_CELL}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const box = { x0: 0.08, x1: 0.92, y0: 0.1, y1: 0.9 };
  [...GLYPH_CHARS].forEach((ch, i) => {
    const m = g.measureText(ch);
    const ascent = m.actualBoundingBoxAscent;
    const height = ascent + m.actualBoundingBoxDescent;
    const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const cx = (i % GLYPH_COLS_) * GLYPH_CELL;
    const cy = Math.floor(i / GLYPH_COLS_) * GLYPH_CELL;
    // Stretch the glyph's own box onto the middle of its cell (a narrow "1" is widened less than it would be: keep its natural width up to the box).
    const sy = ((box.y1 - box.y0) * GLYPH_CELL) / Math.max(height, 1);
    const sx = Math.min(((box.x1 - box.x0) * GLYPH_CELL) / Math.max(width, 1), sy * 1.05);
    g.save();
    g.translate(cx + GLYPH_CELL * 0.5, cy + GLYPH_CELL * box.y1);
    g.scale(sx, sy);
    g.fillText(ch, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, 0);
    g.restore();
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture, mipLevel: 0 }, [size, size]);
  let previous = canvas;
  for (let level = 1; level < mips; level++) {
    const s = Math.max(size >> level, 1);
    const next = new OffscreenCanvas(s, s);
    const n = next.getContext('2d')!;
    n.imageSmoothingEnabled = true;
    n.imageSmoothingQuality = 'high';
    n.drawImage(previous, 0, 0, s, s);
    device.queue.copyExternalImageToTexture({ source: next }, { texture, mipLevel: level }, [s, s]);
    previous = next;
  }
  return texture;
}

/** One black pixel: no glyph shows anywhere (if the canvas cannot draw text). */
function noGlyphs(device: GPUDevice): GPUTexture {
  const texture = device.createTexture({ label: 'ship-glyphs-none', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}

export async function loadWeathering(device: GPUDevice, base = import.meta.env.BASE_URL ?? '/'): Promise<WeatheringTextures> {
  let weather = make(device, 'ship-weathering', WEATHER_TILE, WEATHER_LAYERS);
  let decals = make(device, 'ship-decals', DECAL_TILE, DECAL_LAYERS);
  try {
    await Promise.all([
      upload(device, weather, `${base}textures/weathering.png`, WEATHER_TILE, WEATHER_LAYERS),
      upload(device, decals, `${base}textures/decals.png`, DECAL_TILE, DECAL_LAYERS),
    ]);
  } catch (e) {
    console.warn('ship weathering pictures unavailable; drawing plain ships', e);
    weather.destroy();
    decals.destroy();
    weather = stand(device, 'ship-weathering-neutral', WEATHER_LAYERS, 128);
    decals = stand(device, 'ship-decals-neutral', DECAL_LAYERS, 0);
  }
  let glyphs: GPUTexture;
  try {
    glyphs = makeGlyphs(device);
  } catch (e) {
    console.warn('ship lettering unavailable; drawing ships without it', e);
    glyphs = noGlyphs(device);
  }
  const sampler = device.createSampler({
    label: 'ship-weathering',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 4,
  });
  return { weather, decals, glyphs, sampler };
}
