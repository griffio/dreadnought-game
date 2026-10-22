import { createModule } from '../gpu-util';
import common from '../shaders/common.wgsl?raw';
import env from '../shaders/env.wgsl?raw';
import haze from '../shaders/haze.wgsl?raw';
import noiseChunk from '../shaders/noise.wgsl?raw';
import scene from '../shaders/scene.wgsl?raw';
import shadowChunk from '../shaders/shadow.wgsl?raw';
import skyMap from '../shaders/sky_map.wgsl?raw';
import type { ShadowMap } from '../ships/shadow-map';
import type { OceanField } from './ocean-field';
import surfaceWgsl from './ocean_surface.wgsl?raw';

// Keep in sync with ocean_surface.wgsl.
const GRID_SEGS = 384;
const NEAR_RINGS = 64;
const NEAR_R0 = 2;
const FAR_GROWTH = 1.0235;
const MAX_RADIUS = 40_000;

export interface OceanSurfaceOptions {
  device: GPUDevice;
  sceneBuffer: GPUBuffer;
  field: OceanField;
  skyView: GPUTexture;
  cloudLut: GPUTexture;
  envSampler: GPUSampler;
  noiseView: GPUTextureView;
  noiseSampler: GPUSampler;
  shadow: ShadowMap;
  colorFormat: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  sampleCount: number;
  /** Anisotropic filtering of the wave textures (1, 2 or 4): the main cost of looking along the sea at the horizon. */
  anisotropy?: number;
}

function ringCount(): number {
  let rings = NEAR_RINGS;
  let r = NEAR_R0 + NEAR_RINGS;
  while (r < MAX_RADIUS) {
    r *= FAR_GROWTH;
    rings++;
  }
  return rings + 1;
}

export class OceanSurface {
  private readonly indexBuffer: GPUBuffer;
  private readonly indexCount: number;

  private constructor(
    device: GPUDevice,
    private readonly field: OceanField,
    private readonly pipeline: GPURenderPipeline,
    private readonly sceneGroup: GPUBindGroup,
    private readonly envGroup: GPUBindGroup,
    private readonly waveGroups: [GPUBindGroup, GPUBindGroup],
    private readonly shadowGroup: GPUBindGroup,
  ) {
    const rings = ringCount();
    const indices = new Uint32Array((rings - 1) * GRID_SEGS * 6);
    let o = 0;
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < GRID_SEGS; j++) {
        const j1 = (j + 1) % GRID_SEGS;
        const v00 = i * GRID_SEGS + j;
        const v01 = i * GRID_SEGS + j1;
        const v10 = (i + 1) * GRID_SEGS + j;
        const v11 = (i + 1) * GRID_SEGS + j1;
        indices.set([v00, v10, v01, v01, v10, v11], o);
        o += 6;
      }
    }
    this.indexCount = indices.length;
    this.indexBuffer = device.createBuffer({
      label: 'ocean-indices',
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, indices);
  }

  static async create(opts: OceanSurfaceOptions): Promise<OceanSurface> {
    const { device, field } = opts;
    const module = await createModule(device, 'ocean-surface', common, scene, skyMap, env, noiseChunk, haze, shadowChunk, surfaceWgsl);
    const pipeline = device.createRenderPipeline({
      label: 'ocean-surface',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: opts.colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: opts.sampleCount },
    });

    const sceneGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: opts.sceneBuffer } }],
    });
    const envGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: opts.skyView.createView() },
        { binding: 1, resource: opts.cloudLut.createView() },
        { binding: 2, resource: opts.envSampler },
        { binding: 3, resource: opts.noiseView },
        { binding: 4, resource: opts.noiseSampler },
      ],
    });
    const waveSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      maxAnisotropy: opts.anisotropy ?? 4,
    });
    const arrayView = (t: GPUTexture) => t.createView({ dimension: '2d-array' });
    const waveGroup = (i: number) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: arrayView(field.dispTextures[i]!) },
          { binding: 1, resource: arrayView(field.derivTexture) },
          { binding: 2, resource: waveSampler },
        ],
      });
    const shadowGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(3),
      entries: [
        { binding: 0, resource: opts.shadow.view },
        { binding: 1, resource: opts.shadow.sampler },
      ],
    });
    return new OceanSurface(device, field, pipeline, sceneGroup, envGroup, [waveGroup(0), waveGroup(1)], shadowGroup);
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.sceneGroup);
    pass.setBindGroup(1, this.envGroup);
    pass.setBindGroup(2, this.waveGroups[this.field.currentIndex]!);
    pass.setBindGroup(3, this.shadowGroup);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  destroy(): void {
    this.indexBuffer.destroy();
  }
}
