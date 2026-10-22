export interface CheckResult {
  ok: boolean;
  detail: string;
}

/** Copy `size` bytes out of a GPU buffer (probe/test use only; gameplay never reads back). */
export async function readBuffer(device: GPUDevice, src: GPUBuffer, size: number): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    label: 'readback',
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(src, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}

/** Run `fn` inside validation + out-of-memory error scopes and turn any GPU error into a failed check. */
export async function guarded(device: GPUDevice, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');
  let result: CheckResult;
  try {
    result = await fn();
  } catch (err) {
    result = { ok: false, detail: `threw: ${String(err)}` };
  }
  const oom = await device.popErrorScope();
  const validation = await device.popErrorScope();
  const gpuError = oom ?? validation;
  if (gpuError) return { ok: false, detail: `GPU error: ${gpuError.message}` };
  return result;
}

export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}
