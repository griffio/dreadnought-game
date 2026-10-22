import { omegaQuantised, packSpectrum } from '../../sim/ocean/spectrum';
import { halfToFloat } from '../../platform/probe/gpu-util';
import { OceanField } from './ocean-field';

export interface OceanSelfTestResult {
  ok: boolean;
  /** Worst absolute error per quantity across both test times. */
  maxError: { height: number; displacementX: number; displacementZ: number; slopeX: number };
  detail: string;
}

/**
 * Injects a single travelling wave into the real GPU pipeline (evolve -> inverse FFT -> assemble) and
 * compares the output textures against the analytic solution. This pins down every sign convention:
 * wave direction, choppy displacement direction, slope sign, the checkerboard shift and the time evolution.
 *
 *   h = 2a cos(theta), dx = -2a*chop*sin(theta), dz = 0, dh/dx = -2a k sin(theta),
 *   theta = kx*x - w*t   (waves travel toward +x for kx > 0)
 */
export async function runOceanSelfTest(device: GPUDevice): Promise<OceanSelfTestResult> {
  const n = 64;
  const length = 100;
  const amplitude = 0.5;
  const chop = 0.8;
  const modeIndex = 3; // kx = 3 * dk
  const field = await OceanField.create({ device, size: n, lengths: [length] });

  const h0 = new Float32Array(n * n * 2);
  const ix0 = n / 2 + modeIndex;
  const iz0 = n / 2;
  h0[(iz0 * n + ix0) * 2] = amplitude;
  field.setPackedSpectrum(packSpectrum(h0, n));

  const dk = (2 * Math.PI) / length;
  const kx = modeIndex * dk;
  const omega = omegaQuantised(kx, field.w0);
  const maxError = { height: 0, displacementX: 0, displacementZ: 0, slopeX: 0 };

  for (const t of [0, 37.3]) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    field.encode(pass, t, chop, { bias: 0.9, gains: [1], persistence: 3 }, 1 / 60);
    pass.end();

    const bytesPerRow = n * 8;
    const readBack = (texture: GPUTexture) => {
      const staging = device.createBuffer({
        size: bytesPerRow * n,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder.copyTextureToBuffer({ texture, mipLevel: 0, origin: [0, 0, 0] }, { buffer: staging, bytesPerRow }, [n, n, 1]);
      return staging;
    };
    const dispStaging = readBack(field.dispTextures[field.currentIndex]!);
    const derivStaging = readBack(field.derivTexture);
    device.queue.submit([encoder.finish()]);

    const decode = async (staging: GPUBuffer) => {
      await staging.mapAsync(GPUMapMode.READ);
      const halves = new Uint16Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      return Float32Array.from(halves, halfToFloat);
    };
    const disp = await decode(dispStaging);
    const deriv = await decode(derivStaging);

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const o = (z * n + x) * 4;
        const theta = kx * ((x * length) / n) - omega * t;
        const expect = {
          dx: -2 * amplitude * chop * Math.sin(theta),
          h: 2 * amplitude * Math.cos(theta),
          dz: 0,
          sx: -2 * amplitude * kx * Math.sin(theta),
        };
        maxError.displacementX = Math.max(maxError.displacementX, Math.abs(disp[o]! - expect.dx));
        maxError.height = Math.max(maxError.height, Math.abs(disp[o + 1]! - expect.h));
        maxError.displacementZ = Math.max(maxError.displacementZ, Math.abs(disp[o + 2]! - expect.dz));
        maxError.slopeX = Math.max(maxError.slopeX, Math.abs(deriv[o]! - expect.sx));
      }
    }
  }
  field.destroy();

  const ok =
    maxError.height < 0.01 &&
    maxError.displacementX < 0.01 &&
    maxError.displacementZ < 0.01 &&
    maxError.slopeX < 0.003;
  return {
    ok,
    maxError,
    detail: `omega=${omega.toFixed(4)} max errors h=${maxError.height.toExponential(2)} dx=${maxError.displacementX.toExponential(2)} dz=${maxError.displacementZ.toExponential(2)} sx=${maxError.slopeX.toExponential(2)}`,
  };
}
