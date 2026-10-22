import fftWgsl from '../../render/ocean/ocean_fft_lines.wgsl?raw';
import { readBuffer } from './gpu-util';

export interface FftBenchResult {
  n: number;
  jobs: number;
  dispatchesPerFrame: number;
  correct: boolean;
  maxError: number;
  /** Submit, wait for completion, repeat: latency-bound upper estimate. */
  serialMs: number;
  /** Submit many frames back to back, wait once: throughput estimate. This drives the tier. */
  pipelinedMs: number;
}

const SERIAL_FRAMES = 15;
const PIPELINED_FRAMES = 30;

/**
 * Batched 2D FFT of `jobs` fields of n x n complex values using the ocean's own shared-memory kernel: the
 * per-frame ocean FFT cost (cascades x 4 packed complex fields). Validates against an impulse (whose FFT is all ones), then times it.
 */
export async function runFftBench(device: GPUDevice, n: number, jobs: number): Promise<FftBenchResult> {
  const elements = jobs * n * n;
  const bytes = elements * 8;

  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const bufA = device.createBuffer({ label: 'fft-a', size: bytes, usage });
  const bufB = device.createBuffer({ label: 'fft-b', size: bytes, usage });

  const impulse = new Float32Array(elements * 2);
  for (let job = 0; job < jobs; job++) impulse[job * n * n * 2] = 1;
  const resetInput = () => device.queue.writeBuffer(bufA, 0, impulse);
  resetInput();

  const module = device.createShaderModule({ label: 'fft-bench', code: fftWgsl });
  const pipeline = device.createComputePipeline({
    label: 'fft-bench',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });

  // The same shared-memory kernel the ocean uses: rows (A -> B) then columns (B -> A), two dispatches.
  const bindGroups: GPUBindGroup[] = [];
  const uniformBuffers: GPUBuffer[] = [];
  const axes: [GPUBuffer, GPUBuffer][] = [
    [bufA, bufB],
    [bufB, bufA],
  ];
  axes.forEach(([from, to], axis) => {
    const uniform = device.createBuffer({
      label: `fft-params-${axis}`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniform, 0, new Uint32Array([n, axis, 1, 0]));
    uniformBuffers.push(uniform);
    bindGroups.push(
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: from } },
          { binding: 2, resource: { buffer: to } },
        ],
      }),
    );
  });

  const encodeFrame = (encoder: GPUCommandEncoder) => {
    const pass = encoder.beginComputePass({ label: 'fft-frame' });
    pass.setPipeline(pipeline);
    for (const bindGroup of bindGroups) {
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(n, jobs);
    }
    pass.end();
  };
  const runFrames = async (frames: number, waitEachFrame: boolean) => {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      const encoder = device.createCommandEncoder();
      encodeFrame(encoder);
      device.queue.submit([encoder.finish()]);
      if (waitEachFrame) await device.queue.onSubmittedWorkDone();
    }
    await device.queue.onSubmittedWorkDone();
    return (performance.now() - t0) / frames;
  };

  // Correctness first: FFT of an impulse at the origin must be 1 + 0i everywhere.
  const encoder = device.createCommandEncoder();
  encodeFrame(encoder);
  device.queue.submit([encoder.finish()]);
  const out = new Float32Array(await readBuffer(device, bufA, bytes));
  let maxError = 0;
  for (let i = 0; i < elements; i++) {
    const re = out[i * 2] ?? Number.NaN;
    const im = out[i * 2 + 1] ?? Number.NaN;
    const err = Math.max(Math.abs(re - 1), Math.abs(im));
    // NaN must count as an error, so compare in a way that propagates it.
    maxError = Number.isNaN(err) || err > maxError ? err : maxError;
  }

  // Timing. Values grow every repeat and may overflow to inf; that does not change GPU cost.
  resetInput();
  await runFrames(2, true);
  const serialMs = await runFrames(SERIAL_FRAMES, true);
  const pipelinedMs = await runFrames(PIPELINED_FRAMES, false);

  for (const b of [bufA, bufB, ...uniformBuffers]) b.destroy();

  return {
    n,
    jobs,
    dispatchesPerFrame: bindGroups.length,
    correct: maxError < 1e-3,
    maxError,
    serialMs,
    pipelinedMs,
  };
}
