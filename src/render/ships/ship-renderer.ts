import type { Vec3 } from '../../math/vec3';
import { createModule } from '../gpu-util';
import common from '../shaders/common.wgsl?raw';
import env from '../shaders/env.wgsl?raw';
import haze from '../shaders/haze.wgsl?raw';
import scene from '../shaders/scene.wgsl?raw';
import shadowChunk from '../shaders/shadow.wgsl?raw';
import skyMap from '../shaders/sky_map.wgsl?raw';
import { shipModelMatrix, type ShipPose } from './pose-matrix';
import { MAX_NODES, ShipRig } from './rig';
import { SHADOW_FORMAT, type ShadowMap } from './shadow-map';
import type { ShipModel } from './forge/spec';
import shipWgsl from './ship.wgsl?raw';
import shipU from './ship_u.wgsl?raw';
import shadowWgsl from './ship_shadow.wgsl?raw';
import { VERTEX_STRIDE_BYTES } from './forge/mesh-builder';

/** Floats in the ShipU uniform: model(16) + nodes(96*16) + three vec4. */
const UNIFORM_FLOATS = 16 + MAX_NODES * 16 + 12;

export interface ShipPaint {
  hull: Vec3;
  superstructure: Vec3;
  /** 0 dry .. 1 soaked: darkens and glosses the lower hull. */
  wetness: number;
  /** A fort: the deck is poured concrete, not planks. */
  concrete?: boolean;
}

export const ADMIRALTY_GREY: ShipPaint = {
  hull: [0.115, 0.13, 0.145],
  superstructure: [0.17, 0.185, 0.2],
  wetness: 0.8,
};

/** One ship in the scene: model buffers, animation rig, world pose, paint and its uniform buffer. */
export class ShipInstance {
  readonly rig: ShipRig;
  pose: ShipPose = { x: 0, z: 0, headingDeg: 0, heave: 0, pitch: 0, roll: 0 };
  paint: ShipPaint = { ...ADMIRALTY_GREY };
  /** False once the ship has gone under: it is neither drawn nor shadowed. */
  visible = true;
  /** Metres: none of the ship nearer the camera than this is drawn (the director's sight sits among her mast, and sees out of it). */
  cutaway = 0;

  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly uniformBuffer: GPUBuffer;
  readonly mainGroup: GPUBindGroup;
  readonly shadowGroup: GPUBindGroup;
  private readonly data = new Float32Array(UNIFORM_FLOATS);
  private readonly model = new Float32Array(16);

  constructor(
    device: GPUDevice,
    readonly shipModel: ShipModel,
    mainLayout: GPUBindGroupLayout,
    shadowLayout: GPUBindGroupLayout,
  ) {
    this.rig = new ShipRig(shipModel);
    this.vertexBuffer = device.createBuffer({
      label: `${shipModel.name}-vertices`,
      size: shipModel.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, shipModel.vertices);
    this.indexBuffer = device.createBuffer({
      label: `${shipModel.name}-indices`,
      size: shipModel.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, shipModel.indices);
    this.indexCount = shipModel.indices.length;
    this.uniformBuffer = device.createBuffer({
      label: `${shipModel.name}-uniform`,
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const entries = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
    this.mainGroup = device.createBindGroup({ layout: mainLayout, entries });
    this.shadowGroup = device.createBindGroup({ layout: shadowLayout, entries });
  }

  /** Pack pose, rig and paint into the uniform buffer. */
  write(device: GPUDevice, cameraPos: Vec3): void {
    this.rig.update();
    shipModelMatrix(this.pose, cameraPos, this.model);
    const d = this.data;
    d.set(this.model, 0);
    d.set(this.rig.matrices, 16);
    const o = 16 + MAX_NODES * 16;
    d.set([...this.paint.hull, 0, ...this.paint.superstructure, 0, this.paint.wetness, this.paint.concrete ? 1 : 0, this.cutaway, 0], o);
    device.queue.writeBuffer(this.uniformBuffer, 0, d);
  }

  destroy(): void {
    for (const b of [this.vertexBuffer, this.indexBuffer, this.uniformBuffer]) b.destroy();
  }
}

export interface ShipRendererOptions {
  device: GPUDevice;
  sceneBuffer: GPUBuffer;
  skyView: GPUTexture;
  cloudLut: GPUTexture;
  envSampler: GPUSampler;
  shadow: ShadowMap;
  colorFormat: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  sampleCount: number;
}

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'uint32' },
    { shaderLocation: 3, offset: 28, format: 'uint32' },
  ],
};

export class ShipRenderer {
  readonly ships: ShipInstance[] = [];

  private constructor(
    private readonly device: GPUDevice,
    private readonly mainPipeline: GPURenderPipeline,
    private readonly shadowPipeline: GPURenderPipeline,
    private readonly mainSceneGroup: GPUBindGroup,
    private readonly envGroup: GPUBindGroup,
    private readonly shadowReadGroup: GPUBindGroup,
    private readonly shadowSceneGroup: GPUBindGroup,
  ) {}

  static async create(opts: ShipRendererOptions): Promise<ShipRenderer> {
    const { device } = opts;
    const [mainMod, shadowMod] = await Promise.all([
      createModule(device, 'ship', common, scene, skyMap, env, haze, shadowChunk, shipU, shipWgsl),
      createModule(device, 'ship-shadow', scene, shipU, shadowWgsl),
    ]);

    const mainPipeline = device.createRenderPipeline({
      label: 'ship',
      layout: 'auto',
      vertex: { module: mainMod, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      fragment: { module: mainMod, entryPoint: 'fs', targets: [{ format: opts.colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: opts.sampleCount },
    });
    const shadowPipeline = device.createRenderPipeline({
      label: 'ship-shadow',
      layout: 'auto',
      vertex: { module: shadowMod, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: SHADOW_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 2,
        depthBiasSlopeScale: 2,
        depthBiasClamp: 0,
      },
    });

    const sceneEntry = { binding: 0, resource: { buffer: opts.sceneBuffer } };
    return new ShipRenderer(
      device,
      mainPipeline,
      shadowPipeline,
      device.createBindGroup({ layout: mainPipeline.getBindGroupLayout(0), entries: [sceneEntry] }),
      device.createBindGroup({
        layout: mainPipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: opts.skyView.createView() },
          { binding: 1, resource: opts.cloudLut.createView() },
          { binding: 2, resource: opts.envSampler },
        ],
      }),
      device.createBindGroup({
        layout: mainPipeline.getBindGroupLayout(3),
        entries: [
          { binding: 0, resource: opts.shadow.view },
          { binding: 1, resource: opts.shadow.sampler },
        ],
      }),
      device.createBindGroup({ layout: shadowPipeline.getBindGroupLayout(0), entries: [sceneEntry] }),
    );
  }

  add(model: ShipModel): ShipInstance {
    const ship = new ShipInstance(
      this.device,
      model,
      this.mainPipeline.getBindGroupLayout(2),
      this.shadowPipeline.getBindGroupLayout(1),
    );
    this.ships.push(ship);
    return ship;
  }

  /** Upload every ship's pose and rig. Call once per frame before encoding. */
  update(cameraPos: Vec3): void {
    for (const s of this.ships) s.write(this.device, cameraPos);
  }

  draw(pass: GPURenderPassEncoder): void {
    if (this.ships.length === 0) return;
    pass.setPipeline(this.mainPipeline);
    pass.setBindGroup(0, this.mainSceneGroup);
    pass.setBindGroup(1, this.envGroup);
    pass.setBindGroup(3, this.shadowReadGroup);
    for (const s of this.ships) {
      if (!s.visible) continue;
      pass.setBindGroup(2, s.mainGroup);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.setIndexBuffer(s.indexBuffer, 'uint32');
      pass.drawIndexed(s.indexCount);
    }
  }

  drawShadow(pass: GPURenderPassEncoder): void {
    if (this.ships.length === 0) return;
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, this.shadowSceneGroup);
    for (const s of this.ships) {
      if (!s.visible) continue;
      pass.setBindGroup(1, s.shadowGroup);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.setIndexBuffer(s.indexBuffer, 'uint32');
      pass.drawIndexed(s.indexCount);
    }
  }
}
