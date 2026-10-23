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
import { MATERIAL } from './forge/mesh-builder';
import { firstIndexAbove, sortTriangles } from './triangles';

/** The materials that are her sheets: the hull and the decks, which cover most of her pixels. */
const SHEETS: ReadonlySet<number> = new Set([MATERIAL.HULL, MATERIAL.DECK]);
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
/** The bind group layouts of a ship's own uniform (group 2, or 1 for the shadow) in each of the pipelines that draw her. */
interface ShipLayouts {
  main: GPUBindGroupLayout;
  clip: GPUBindGroupLayout;
  equal: GPUBindGroupLayout;
  depth: GPUBindGroupLayout;
  shadow: GPUBindGroupLayout;
}

export class ShipInstance {
  readonly rig: ShipRig;
  pose: ShipPose = { x: 0, z: 0, headingDeg: 0, heave: 0, pitch: 0, roll: 0 };
  paint: ShipPaint = { ...ADMIRALTY_GREY };
  /** False once the ship has gone under: it is neither drawn nor shadowed. */
  visible = true;
  /** The marks of the hits she has taken, projected onto her hull by the shader. */
  readonly decals: DecalSet;
  /** Does her works need the pipeline that can leave pixels out: does the sight sit among her mast, or is she broken in two? */
  get needsClip(): boolean {
    return (this.parent ?? this).cutaway > 0 || this.split.side !== 0;
  }

  /** Ship-space height below which nothing of her works can be within the cutaway's reach of the lens (the lens's height less the radius). */
  cutawayFloor = Number.POSITIVE_INFINITY;

  /** Her triangles: the sheets (hull, decks) first, then the works by height (see triangles.ts). */
  readonly worksStart: number;
  private readonly maxY: Float32Array;

  /**
   * Where the run of triangles that is drawn with the pipeline that can discard begins (it runs to the end). A ship broken in two cuts all
   * her works that way (her sheets are cut at the vertices); under the sight's cutaway only the works that can reach the lens are.
   */
  get clipStart(): number {
    if (this.split.side !== 0) return this.worksStart;
    return this.worksStart + firstIndexAbove(this.maxY, (this.parent ?? this).cutawayFloor);
  }

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
  /** The same uniform for each of the other pipelines (a bind group made for one pipeline's layout does not fit another's). */
  readonly clipGroup: GPUBindGroup;
  readonly equalGroup: GPUBindGroup;
  readonly depthGroup: GPUBindGroup;
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
    layouts: ShipLayouts,
    parent: ShipInstance | null = null,
  ) {
    this.parent = parent;
    if (parent) {
      // A part of a broken ship: the model's buffers and the rig are the parent's.
      this.rig = parent.rig;
      this.vertexBuffer = parent.vertexBuffer;
      this.indexBuffer = parent.indexBuffer;
      this.indexCount = parent.indexCount;
      this.maxY = parent.maxY;
      this.worksStart = parent.worksStart;
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
      const sorted = sortTriangles(shipModel.vertices, shipModel.indices, SHEETS);
      this.maxY = sorted.maxY;
      this.worksStart = sorted.worksStart;
      device.queue.writeBuffer(this.indexBuffer, 0, sorted.indices);
      this.indexCount = shipModel.indices.length;
      this.decals = new DecalSet();
    }
    this.uniformBuffer = device.createBuffer({
      label: `${shipModel.name}-uniform`,
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const entries = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
    this.mainGroup = device.createBindGroup({ layout: layouts.main, entries });
    this.clipGroup = device.createBindGroup({ layout: layouts.clip, entries });
    this.equalGroup = device.createBindGroup({ layout: layouts.equal, entries });
    this.depthGroup = device.createBindGroup({ layout: layouts.depth, entries });
    this.shadowGroup = device.createBindGroup({ layout: layouts.shadow, entries });
  }

  /** Pack pose, rig and paint into the uniform buffer. */
  write(device: GPUDevice, cameraPos: Vec3, simTime = 0, detail = 0): void {
    const src = this.parent ?? this;
    if (!this.parent) this.rig.update();
    shipModelMatrix(this.pose, cameraPos, this.model);
    // A part of a broken ship is moved about the break after she is placed.
    const place = this.section ? mulMat4(this.model, this.section, this.placed) : this.model;
    const d = this.data;
    d.set(place, 0);
    d.set(src.rig.matrices, 16);
    const o = 16 + MAX_NODES * 16;
    // The dazzle seed's sign names the scheme the shader draws: positive the Royal Navy's patches, negative the Baltic stripes.
    const dazzle = (src.paint.markings?.dazzle ?? 0) * (src.paint.markings?.scheme === 'baltic' ? -1 : 1);
    d.set([...src.paint.hull, 0, ...src.paint.superstructure, 0, src.paint.wetness, src.paint.concrete ? 1 : 0, src.cutaway, dazzle], o);
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
    d.set([src.flutter, detail, ENSIGN_CODE[src.paint.markings?.ensign ?? 'white'], this.shipModel.length * 0.0242], c + MAX_NODES + MAX_FIRES * 4 + 4 + MARK_FLOATS);
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

/** What is bound for the ship pipeline besides each ship's own uniform: the scene, the sky and pictures, and the shadow map. */
interface ShipBinds {
  scene: GPUBindGroup;
  env: GPUBindGroup;
  shadow: GPUBindGroup;
}

export class ShipRenderer {
  readonly ships: ShipInstance[] = [];

  private constructor(
    private readonly device: GPUDevice,
    private readonly mainPipeline: GPURenderPipeline,
    /** The same shader made with the power to discard pixels (see `use_discard` in ship.wgsl): the survey's comparison. */
    private readonly clipPipeline: GPURenderPipeline,
    /**
     * A ship's cuttable works are drawn in two steps instead (see `draw`): their depth alone, by a shader that does the cutting, and then
     * their colour, by the discard-free shader, only where the depth is the one the first step left.
     */
    private readonly depthPipeline: GPURenderPipeline,
    private readonly equalPipeline: GPURenderPipeline,
    private readonly shadowPipeline: GPURenderPipeline,
    private readonly mainBinds: ShipBinds,
    private readonly clipBinds: ShipBinds,
    private readonly equalBinds: ShipBinds,
    private readonly depthScene: GPUBindGroup,
    private readonly depthEmpty: GPUBindGroup,
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
      fragment: { module: mainMod, entryPoint: 'fs', targets: [{ format: opts.colorFormat }], constants: { use_discard: 0 } },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: opts.sampleCount },
    });
    // The same again, able to discard. (Its default layout is its own, so everything bound to it is made for it: see `ShipBinds`.)
    const clipPipeline = device.createRenderPipeline({
      label: 'ship-clip',
      layout: 'auto',
      vertex: { module: mainMod, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      fragment: { module: mainMod, entryPoint: 'fs', targets: [{ format: opts.colorFormat }], constants: { use_discard: 1 } },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: opts.sampleCount },
    });
    const depthPipeline = device.createRenderPipeline({
      label: 'ship-depth',
      layout: 'auto',
      vertex: { module: mainMod, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      fragment: { module: mainMod, entryPoint: 'fs_depth', targets: [{ format: opts.colorFormat, writeMask: 0 }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: opts.sampleCount },
    });
    const equalPipeline = device.createRenderPipeline({
      label: 'ship-equal',
      layout: 'auto',
      vertex: { module: mainMod, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      fragment: { module: mainMod, entryPoint: 'fs', targets: [{ format: opts.colorFormat }], constants: { use_discard: 0 } },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: false, depthCompare: 'equal' },
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
    const binds = (pipeline: GPURenderPipeline): ShipBinds => ({
      scene: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [sceneEntry] }),
      env: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
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
      shadow: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(3),
        entries: [
          { binding: 0, resource: opts.shadow.view },
          { binding: 1, resource: opts.shadow.sampler },
        ],
      }),
    });
    return new ShipRenderer(
      device,
      mainPipeline,
      clipPipeline,
      depthPipeline,
      equalPipeline,
      shadowPipeline,
      binds(mainPipeline),
      binds(clipPipeline),
      binds(equalPipeline),
      device.createBindGroup({ layout: depthPipeline.getBindGroupLayout(0), entries: [sceneEntry] }),
      device.createBindGroup({ layout: depthPipeline.getBindGroupLayout(1), entries: [] }),
      device.createBindGroup({ layout: shadowPipeline.getBindGroupLayout(0), entries: [sceneEntry] }),
    );
  }

  private layouts(): ShipLayouts {
    return {
      main: this.mainPipeline.getBindGroupLayout(2),
      clip: this.clipPipeline.getBindGroupLayout(2),
      equal: this.equalPipeline.getBindGroupLayout(2),
      depth: this.depthPipeline.getBindGroupLayout(2),
      shadow: this.shadowPipeline.getBindGroupLayout(1),
    };
  }

  add(model: ShipModel): ShipInstance {
    const ship = new ShipInstance(this.device, model, this.layouts());
    this.ships.push(ship);
    return ship;
  }

  /** The second part of a ship that has broken in two: it shares her model, and is hidden until it is wanted. */
  addSection(parent: ShipInstance): ShipInstance {
    const part = new ShipInstance(this.device, parent.shipModel, this.layouts(), parent);
    part.visible = false;
    this.ships.push(part);
    return part;
  }

  /** Upload every ship's pose and rig. Call once per frame before encoding. */
  update(cameraPos: Vec3, simTime = 0, detail = 0): void {
    // A ship that is not drawn (at anchor behind the front door, sunk, a part not yet broken off) needs no rig or upload; a part that
    // is drawn always has its parent drawn too, so the rig it shares is fresh.
    for (const s of this.ships) if (s.visible) s.write(this.device, cameraPos, simTime, detail);
  }

  /**
   * Draw the ships. A ship's triangles are in three runs: her sheets (hull, decks), her works below the reach of the sight's lens, and her
   * works that can be cut. Ordinarily all of them are drawn with the pipeline that cannot discard; a ship under the sight's cutaway or broken
   * in two has the last run drawn with the one that can. On a tile-based GPU every switch to a pipeline that discards makes it settle what is
   * hidden before it goes on, so every ship's discard-free runs are drawn first, and the runs that discard last.
   *
   * `forceClip` draws every ship whole with the discarding pipeline, which is what the survey compares them with; `parts` 1 draws only the
   * sheets and 2 only the works (the survey's way of telling where the cost of a broken ship is).
   */
  draw(pass: GPURenderPassEncoder, forceClip = false, parts = 0): void {
    if (this.ships.length === 0) return;
    let current: GPURenderPipeline | null = null;
    const use = (clip: boolean, s: ShipInstance): void => {
      const pipeline = clip ? this.clipPipeline : this.mainPipeline;
      if (pipeline !== current) {
        current = pipeline;
        const binds = clip ? this.clipBinds : this.mainBinds;
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, binds.scene);
        pass.setBindGroup(1, binds.env);
        pass.setBindGroup(3, binds.shadow);
      }
      pass.setBindGroup(2, clip ? s.clipGroup : s.mainGroup);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.setIndexBuffer(s.indexBuffer, 'uint32');
    };
    // First, everything that needs no discarding.
    for (const s of this.ships) {
      if (!s.visible || forceClip) continue;
      const first = parts === 2 ? s.worksStart : 0;
      const last = parts === 1 ? s.worksStart : s.needsClip ? s.clipStart : s.indexCount;
      if (last > first) {
        use(false, s);
        pass.drawIndexed(last - first, 1, first);
      }
    }
    // Then the works that are cut. The survey's comparison draws every ship whole with the pipeline that discards. Otherwise a cuttable run
    // is drawn in two steps for every ship in turn: its depth alone, by a shader that does the cutting and shades nothing, and then its colour,
    // by the discard-free shader, only where the depth is the one the first step left. A hidden part of it is then never shaded, which is
    // what a shader that discards could not promise.
    if (forceClip) {
      for (const s of this.ships) {
        if (!s.visible) continue;
        use(true, s);
        pass.drawIndexed(s.indexCount);
      }
      return;
    }
    if (parts === 1) return;
    const cut = this.ships.filter((s) => s.visible && s.needsClip && s.clipStart < s.indexCount);
    if (cut.length === 0) return;
    pass.setPipeline(this.depthPipeline);
    pass.setBindGroup(0, this.depthScene);
    pass.setBindGroup(1, this.depthEmpty);
    for (const s of cut) {
      pass.setBindGroup(2, s.depthGroup);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.setIndexBuffer(s.indexBuffer, 'uint32');
      pass.drawIndexed(s.indexCount - s.clipStart, 1, s.clipStart);
    }
    pass.setPipeline(this.equalPipeline);
    pass.setBindGroup(0, this.equalBinds.scene);
    pass.setBindGroup(1, this.equalBinds.env);
    pass.setBindGroup(3, this.equalBinds.shadow);
    for (const s of cut) {
      pass.setBindGroup(2, s.equalGroup);
      pass.setVertexBuffer(0, s.vertexBuffer);
      pass.setIndexBuffer(s.indexBuffer, 'uint32');
      pass.drawIndexed(s.indexCount - s.clipStart, 1, s.clipStart);
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
