import { describe, expect, it } from 'vitest';
import { generateTileableNoise } from '../src/render/sky/noise-texture';

describe('generateTileableNoise', () => {
  const size = 128;
  const noise = generateTileableNoise(size, 8, 7);
  const at = (x: number, y: number) => noise[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!;

  it('is deterministic per seed and differs between seeds', () => {
    expect(Array.from(generateTileableNoise(size, 8, 7).slice(0, 64))).toEqual(Array.from(noise.slice(0, 64)));
    expect(Array.from(generateTileableNoise(size, 8, 8).slice(0, 64))).not.toEqual(Array.from(noise.slice(0, 64)));
  });

  it('is centred and spread over the range', () => {
    const mean = noise.reduce((s, v) => s + v, 0) / noise.length / 255;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(Math.min(...noise)).toBeLessThan(60);
    expect(Math.max(...noise)).toBeGreaterThan(195);
  });

  it('tiles: the step across the wrap seam is no larger than a step inside the texture', () => {
    let worstInside = 0;
    let worstSeam = 0;
    for (let i = 0; i < size; i++) {
      for (let j = 1; j < size - 1; j++) {
        worstInside = Math.max(worstInside, Math.abs(at(j + 1, i) - at(j, i)), Math.abs(at(i, j + 1) - at(i, j)));
      }
      worstSeam = Math.max(worstSeam, Math.abs(at(0, i) - at(size - 1, i)), Math.abs(at(i, 0) - at(i, size - 1)));
    }
    expect(worstSeam).toBeLessThanOrEqual(worstInside + 1);
  });

  it('is smooth: neighbouring texels differ by a small fraction of the range', () => {
    let worst = 0;
    for (let i = 0; i < size; i++) for (let j = 0; j < size - 1; j++) worst = Math.max(worst, Math.abs(at(j + 1, i) - at(j, i)));
    expect(worst).toBeLessThan(40);
  });
});
