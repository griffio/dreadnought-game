import type { Vec3 } from '../../math/vec3';
import { createModule } from '../gpu-util';
import common from '../shaders/common.wgsl?raw';
import env from '../shaders/env.wgsl?raw';
import haze from '../shaders/haze.wgsl?raw';
import scene from '../shaders/scene.wgsl?raw';
import shadowChunk from '../shaders/shadow.wgsl?raw';
import skyMap from '../shaders/sky_map.wgsl?raw';
import { mulMat4, type Mat4 } from '../../math/mat4';
import { DECAL_FLOATS, DecalSet, MAX_DECALS } from './decals';
import { MAX_FIRES, packFires, type FireSite } from './fires';
import { ENSIGN_CODE, MARK_FLOATS, packMarks, type ShipMarkings } from './marks';
import { shipModelMatrix, type ShipPose } from './pose-matrix';
import { MAX_NODES, ShipRig } from './rig';
import { SHADOW_FORMAT, type ShadowMap } from './shadow-map';
import type { ShipModel } from './forge/spec';
import shipWgsl from './ship.wgsl?raw';
import shipU from './ship_u.wgsl?raw';
import shadowWgsl from './ship_shadow.wgsl?raw';
import { VERTEX_STRIDE_BYTES } from './forge/mesh-builder';
import type { WeatheringTextures } from './weathering';

/** Floats in the ShipU uniform: model(16) + nodes(96*16) + three vec4 of paint + a vec4 of clock + the decals + the nodes' char + the fires + the split. */
const UNIFORM_FLOATS = 16 + MAX_NODES * 16 + 12 + 4 + MAX_DECALS * DECAL_FLOATS + MAX_NODES + MAX_FIRES * 4 + 4 + MARK_FLOATS + 4;

export interface ShipPaint {
  hull: Vec3;
  superstructure: Vec3;
  /** 0 dry .. 1 soaked: darkens and glosses the lower hull. */
  wetness: number;
  /** A fort: the deck is poured concrete, not planks. */
  concrete?: boolean;
  /** 0 as new, 1 long at sea: how much rust, wear and grime the ship shows (default 0.55). */
  weathering?: number;
  /** What is painted on her and flown from her: her hull number, turret letters, ensign and any dazzle. */
  markings?: ShipMarkings;
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
  /** The marks of the hits she has taken, projected onto her hull by the shader. */
  readonly decals: DecalSet;
  /** Metres: none of the ship nearer the camera than this is drawn (the director's sight sits among her mast, and sees out of it). */
  cutaway = 0;
  /** The fires burning in her, ship-space position and intensity (x, y, z, w), the brightest first: they glow on her hull. */
  readonly fires = new Float32Array(MAX_FIRES * 4);
  fireCount = 0;
  /** How hard her flags ripple, 0 (hanging) to 1 (a gale along them): set from the wind she is making. */
  flutter = 0.5;
  /** A ship broken in two shows one part of herself (see ShipU.split); side 0 is the whole ship. */
  split = { x: 0, side: 0, ragged: 0, age: 0 };

  /**
   * A ship that has broken in two is drawn as two instances sharing one model: the first shows the part forward of the break and this
   * second one the part aft. It takes its paint, marks, fires and rig from `parent`, and has a pose and a section matrix of its own.
   */
  readonly parent: ShipInstance | null;
  /** Ship space -> ship space, put after the pose: where this part of a broken ship lies (see section.ts); null when she is whole. */
  section: Mat4 | null = null;

  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly uniformBuffer: GPUBuffer;
  readonly mainGroup: GPUBindGroup;
  readonly shadowGroup: GPUBindGroup;
  private readonly data = new Float32Array(UNIFORM_FLOATS);
  private readonly model = new Float32Array(16);
  private readonly placed = new Float32Array(16);
  /** The marks as packed for the shader, and the markings they were packed from. */
  private marks = new Float32Array(MARK_FLOATS);
  private markSource: ShipMarkings | undefined | null = null;

  constructor(
    device: GPUDevice,
    readonly shipModel: ShipModel,
    mainLayout: GPUBindGroupLayout,
    shadowLayout: GPUBindGroupLayout,
    parent: ShipInstance | null = null,
  ) {
    this.parent = parent;
    if (parent) {
      // A part of a broken ship: the model's buffers and the rig are the parent's.
      this.rig = parent.rig;
      this.vertexBuffer = parent.vertexBuffer;
      this.indexBuffer = parent.indexBuffer;
      this.indexCount = parent.indexCount;
      this.decals = parent.decals;
    } else {
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
      this.decals = new DecalSet();
    }
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
  write(device: GPUDevice, cameraPos: Vec3, simTime = 0): void {
    const src = this.parent ?? this;
    if (!this.parent) this.rig.update();
    shipModelMatrix(this.pose, cameraPos, this.model);
    // A part of a broken ship is moved about the break after she is placed.
    const place = this.section ? mulMat4(this.model, this.section, this.placed) : this.model;
    const d = this.data;
    d.set(place, 0);
    d.set(src.rig.matrices, 16);
    const o = 16 + MAX_NODES * 16;
    d.set([...src.paint.hull, 0, ...src.paint.superstructure, 0, src.paint.wetness, src.paint.concrete ? 1 : 0, src.cutaway, src.paint.markings?.dazzle ?? 0], o);
    d.set([simTime, src.paint.weathering ?? 0.55, src.decals.count, src.fireCount], o + 12);
    src.decals.pack(d, o + 16);
    const c = o + 16 + MAX_DECALS * DECAL_FLOATS;
    d.set(src.rig.char, c);
    d.set(src.fires, c + MAX_NODES);
    d.set([this.split.x, this.split.side, this.split.ragged, this.split.age], c + MAX_NODES + MAX_FIRES * 4);
    if (src.paint.markings !== this.markSource) {
      this.markSource = src.paint.markings;
      packMarks(this.shipModel, src.paint.markings, this.marks);
    }
    d.set(this.marks, c + MAX_NODES + MAX_FIRES * 4 + 4);
    d.set([src.flutter, 0, ENSIGN_CODE[src.paint.markings?.ensign ?? 'white'], this.shipModel.length * 0.0242], c + MAX_NODES + MAX_FIRES * 4 + 4 + MARK_FLOATS);
    device.queue.writeBuffer(this.uniformBuffer, 0, d);
  }

  /** Set the fires that light her from the damage model's fire sites (any number: the brightest are kept). */
  setFires(sites: readonly FireSite[]): void {
    this.fireCount = packFires(sites, this.fires);
  }

  /** The same from numbers in fours (position, intensity), as a replay keeps them. */
  setFiresRaw(a: ArrayLike<number>): void {
    this.fires.fill(0);
    this.fireCount = Math.min(Math.floor(a.length / 4), MAX_FIRES);
    for (let i = 0; i < this.fireCount * 4; i++) this.fires[i] = a[i]!;
  }

  destroy(): void {
    // A part of a broken ship shares its buffers with her parent, who destroys them.
    const own = this.parent ? [this.uniformBuffer] : [this.vertexBuffer, this.indexBuffer, this.uniformBuffer];
    for (const b of own) b.destroy();
  }
}

export interface ShipRendererOptions {
  device: GPUDevice;
  sceneBuffer: GPUBuffer;
  skyView: GPUTexture;
  cloudLut: GPUTexture;
  envSampler: GPUSampler;
  shadow: ShadowMap;
  /** The weathering and decal pictures. */
  weathering: WeatheringTextures;
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
          { binding: 3, resource: opts.weathering.weather.createView({ dimension: '2d-array' }) },
          { binding: 4, resource: opts.weathering.decals.createView({ dimension: '2d-array' }) },
          { binding: 5, resource: opts.weathering.sampler },
          { binding: 6, resource: opts.weathering.glyphs.createView() },
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

  /** The second part of a ship that has broken in two: it shares her model, and is hidden until it is wanted. */
  addSection(parent: ShipInstance): ShipInstance {
    const part = new ShipInstance(this.device, parent.shipModel, this.mainPipeline.getBindGroupLayout(2), this.shadowPipeline.getBindGroupLayout(1), parent);
    part.visible = false;
    this.ships.push(part);
    return part;
  }

  /** Upload every ship's pose and rig. Call once per frame before encoding. */
  update(cameraPos: Vec3, simTime = 0): void {
    for (const s of this.ships) s.write(this.device, cameraPos, simTime);
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
