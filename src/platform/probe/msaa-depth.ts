import { guarded, halfToFloat, type CheckResult } from './gpu-util';

const SIZE = 64;
const SAMPLES = 4;
const KNOWN_DEPTH = 0.25;

const DEPTH_WRITE_WGSL = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[i], ${KNOWN_DEPTH}, 1.0);
}
`;

const DEPTH_RESOLVE_WGSL = /* wgsl */ `
@group(0) @binding(0) var depthMS: texture_depth_multisampled_2d;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) f32 {
  let c = vec2<i32>(pos.xy);
  var d = 1.0;
  for (var s = 0; s < ${SAMPLES}; s++) {
    d = min(d, textureLoad(depthMS, c, s));
  }
  return d;
}
`;

/**
 * WebGPU cannot auto-resolve depth, but soft particles and post need a single-sample copy.
 * Proves the custom path (MSAA depth sampled as texture_depth_multisampled_2d) works on this browser/GPU.
 */
export function checkMsaaDepthResolve(device: GPUDevice): Promise<CheckResult> {
  return guarded(device, async () => {
    const depth = device.createTexture({
      label: 'probe-depth-ms',
      size: [SIZE, SIZE],
      format: 'depth32float',
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const resolved = device.createTexture({
      label: 'probe-depth-resolved',
      size: [SIZE, SIZE],
      format: 'r32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = SIZE * 4; // 256: already copy-aligned
    const staging = device.createBuffer({
      size: bytesPerRow * SIZE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const writeModule = device.createShaderModule({ code: DEPTH_WRITE_WGSL });
    const writePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: writeModule, entryPoint: 'vs' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
      multisample: { count: SAMPLES },
    });
    const resolveModule = device.createShaderModule({ code: DEPTH_RESOLVE_WGSL });
    const resolvePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: resolveModule, entryPoint: 'vs' },
      fragment: { module: resolveModule, entryPoint: 'fs', targets: [{ format: 'r32float' }] },
    });
    const bindGroup = device.createBindGroup({
      layout: resolvePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: depth.createView() }],
    });

    const encoder = device.createCommandEncoder();
    const writePass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    writePass.setPipeline(writePipeline);
    writePass.draw(3);
    writePass.end();

    const resolvePass = encoder.beginRenderPass({
      colorAttachments: [
        { view: resolved.createView(), clearValue: { r: 1, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    resolvePass.setPipeline(resolvePipeline);
    resolvePass.setBindGroup(0, bindGroup);
    resolvePass.draw(3);
    resolvePass.end();

    encoder.copyTextureToBuffer({ texture: resolved }, { buffer: staging, bytesPerRow }, [SIZE, SIZE]);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const pixels = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();

    const centre = pixels[(SIZE / 2) * SIZE + SIZE / 2] ?? Number.NaN;
    for (const r of [depth, resolved, staging]) r.destroy();
    const ok = Math.abs(centre - KNOWN_DEPTH) < 1e-5;
    return { ok, detail: `resolved depth ${centre} (expected ${KNOWN_DEPTH})` };
  });
}

/** HDR scene target: rgba16float, 4x MSAA, resolved to a single-sample texture. */
export function checkHdrMsaaResolve(device: GPUDevice): Promise<CheckResult> {
  return guarded(device, async () => {
    const colour = device.createTexture({
      label: 'probe-hdr-ms',
      size: [SIZE, SIZE],
      format: 'rgba16float',
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const resolved = device.createTexture({
      label: 'probe-hdr-resolved',
      size: [SIZE, SIZE],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    });
    const bytesPerRow = SIZE * 8; // 512
    const staging = device.createBuffer({
      size: bytesPerRow * SIZE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colour.createView(),
          resolveTarget: resolved.createView(),
          clearValue: { r: 2.5, g: 0.25, b: 0.125, a: 1 },
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
    });
    pass.end();
    encoder.copyTextureToBuffer({ texture: resolved }, { buffer: staging, bytesPerRow }, [SIZE, SIZE]);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const halves = new Uint16Array(staging.getMappedRange().slice(0));
    staging.unmap();

    const base = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
    const r = halfToFloat(halves[base] ?? 0);
    const g = halfToFloat(halves[base + 1] ?? 0);
    for (const t of [colour, resolved, staging]) t.destroy();
    const ok = Math.abs(r - 2.5) < 1e-3 && Math.abs(g - 0.25) < 1e-3;
    return { ok, detail: `resolved (${r}, ${g}) — values above 1.0 survive, so HDR works` };
  });
}
