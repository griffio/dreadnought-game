import { readBuffer, type CheckResult } from './gpu-util';

const WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> counter: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main() {
  atomicAdd(&counter[0], 1u);
}
`;

const WORKGROUP_SIZE = 64;

/**
 * A 2026 WebKit report says iOS breaks when ~400-600 compute dispatches are batched into one submit.
 * This checks both shapes (many dispatches in one pass, many passes in one encoder) and verifies the count.
 */
export async function runDispatchStress(device: GPUDevice, count: number): Promise<CheckResult> {
  const module = device.createShaderModule({ label: 'stress', code: WGSL });
  const pipeline = device.createComputePipeline({ label: 'stress', layout: 'auto', compute: { module, entryPoint: 'main' } });
  const counter = device.createBuffer({
    label: 'stress-counter',
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: counter } }],
  });
  const expected = count * WORKGROUP_SIZE;
  const notes: string[] = [];
  let ok = true;

  const shapes: [string, (encoder: GPUCommandEncoder) => void][] = [
    [
      `${count} dispatches in 1 pass`,
      (encoder) => {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        for (let i = 0; i < count; i++) pass.dispatchWorkgroups(1);
        pass.end();
      },
    ],
    [
      `${count} passes in 1 encoder`,
      (encoder) => {
        for (let i = 0; i < count; i++) {
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(1);
          pass.end();
        }
      },
    ],
  ];

  for (const [name, encode] of shapes) {
    device.queue.writeBuffer(counter, 0, new Uint32Array([0, 0, 0, 0]));
    const t0 = performance.now();
    const encoder = device.createCommandEncoder();
    encode(encoder);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    const got = new Uint32Array(await readBuffer(device, counter, 16))[0] ?? -1;
    const pass = got === expected;
    ok &&= pass;
    notes.push(`${name}: ${pass ? 'ok' : `WRONG (got ${got}, expected ${expected})`} in ${ms.toFixed(1)} ms`);
  }

  counter.destroy();
  return { ok, detail: notes.join('; ') };
}
