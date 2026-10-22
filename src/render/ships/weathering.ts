/**
 * The ships' weathering and damage pictures: two small atlases (made by tools/process-textures.py, see there for what is in each
 * channel) uploaded as texture arrays with a full set of mip levels. If they cannot be had the ships are drawn without them: the
 * shader is given neutral layers, which change nothing.
 */
export const WEATHER_TILE = 512;
export const WEATHER_LAYERS = 6;
export const DECAL_TILE = 256;
export const DECAL_LAYERS = 3;

export interface WeatheringTextures {
  weather: GPUTexture;
  decals: GPUTexture;
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
  const sampler = device.createSampler({
    label: 'ship-weathering',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 4,
  });
  return { weather, decals, sampler };
}
