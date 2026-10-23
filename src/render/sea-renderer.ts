import { loadWeathering } from './ships/weathering';
import { degToRad, type Vec3 } from '../math/vec3';
import type { GpuContext } from '../platform/gpu-device';
import { compassToWaveDir, heightFromModes } from '../sim/ocean/spectrum';
import { CASCADE_LENGTHS, DEFAULT_WAVE_SPEC } from '../sim/ocean/waves';
import type { Camera } from './camera';
import { GpuTimer, type GpuTimes } from './gpu-timer';
import { OCEAN_LOOP_SECONDS, OceanField, type FoamSettings } from './ocean/ocean-field';
import { OceanSurface } from './ocean/ocean-surface';
import { Effects } from './fx/effects';
import { ParticleSystem } from './fx/particles';
import { PostProcess } from './post/post';
import { SCENE_BYTES, SCENE_AMBIENT_BYTE_OFFSET, SCENE_UPLOAD_FLOATS, SLOT, SceneBlock } from './scene-block';
import { ShipRenderer, type ShipInstance } from './ships/ship-renderer';
import { ShadowMap, sunShadowMatrix } from './ships/shadow-map';
import type { ShipModel } from './ships/forge/spec';
import { Atmosphere } from './sky/atmosphere';
import { TerrainRenderer } from './terrain/terrain-renderer';
import { SurfLines } from '../sim/terrain/surf';
import type { Terrain } from '../sim/terrain/terrain';
import { WakeRibbons } from './wake/wake-ribbons';
import { buildHullFoam, buildWake, VertexSink, type WakeHistory, type WakeShip } from '../sim/ships/wake';
import { exposureStops, sunlightAt } from './sky/atmosphere-cpu';

export interface SeaParams {
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  /** Wind speed at 10 m (m/s). */
  windSpeed: number;
  /** Compass heading the waves travel toward. */
  waveHeadingDeg: number;
  fetchKm: number;
  cloudCover: number;
  cloudAltitudeM: number;
  /** Cloud drift speed (m/s) along the wave heading. */
  cloudDriftMs: number;
  visibilityKm: number;
  exposureBias: number;
  choppiness: number;
  bloom: number;
  seed: number;
}

export const DEFAULT_SEA: SeaParams = {
  sunElevationDeg: 6,
  sunAzimuthDeg: 250,
  // The waves (wind, heading, fetch, seed) are the sim's defaults, so a fight measured without a renderer floats on this very sea.
  ...DEFAULT_WAVE_SPEC,
  cloudCover: 0.5,
  cloudAltitudeM: 1800,
  cloudDriftMs: 6,
  visibilityKm: 45,
  exposureBias: 0,
  choppiness: 1.0,
  bloom: 0.12,
};

export interface SeaQuality {
  /** FFT resolution per cascade. */
  oceanSize: 128 | 256;
  msaa: 1 | 4;
  /** Sun shadow map resolution. */
  shadowSize: 2048 | 4096;
  /** Anisotropic filtering of the wave textures. */
  anisotropy?: 1 | 2 | 4;
}

const SUN_ANGULAR_RADIUS = 0.00465;
const BASE_EXPOSURE = 3.2;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
const FOAM: FoamSettings = { bias: 0.92, gains: [1.2, 2.2, 0.9], persistence: 3.0 };

/** Something that leaves a wake: its path history, hull shape and current state. */
export interface WakeSource {
  history: WakeHistory;
  ship: WakeShip;
  hull: { length: number; halfBreadthAt: (x: number) => number };
  state(): { x: number; z: number; headingDeg: number; speed: number };
}

/** Switches for measuring what each feature costs (the performance survey flips these). */
export interface SeaDebugFlags {
  skipShadow: boolean;
  skipShips: boolean;
  skipBloom: boolean;
  freezeOcean: boolean;
  skipOceanDraw: boolean;
  skipSkyDraw: boolean;
  skipClouds: boolean;
  skipFx: boolean;
  skipTerrain: boolean;
  /** The survey's ladder of the ship's finish, 0 (all of it) to 5 (flat colour, no shadow, no reflection): see ship.wgsl. */
  shipDetail: number;
  /** Draw every ship with the pipeline that can discard pixels, as the sight's cutaway needs (the survey's comparison). */
  shipDiscard: boolean;
  /** Draw only part of each ship: 0 all of her, 1 her hull and decks, 2 her works (the survey's way of finding where a cost is). */
  shipParts: number;
  /** Draw the whole circle of the sea's grid, not only the arc the camera can see (for comparison: `?oceancull=0`). */
  oceanWholeCircle: boolean;
}

/** Wakes farther than this from the camera are not built (they would be a few pixels). */
const WAKE_RANGE_M = 1800;

/** Surf is laid along the shores this far from the camera. */
const SURF_RANGE_M = 4500;

/** Cloud LUT and sky ambient refresh every this many frames: clouds drift a fraction of a degree per second. */
const CLOUD_REFRESH_FRAMES = 4;

export class SeaRenderer {
  params: SeaParams;
  /** Simulation clock (s) the wake ages are measured against. The game loop sets it each frame. */
  simTime = 0;
  readonly debug: SeaDebugFlags = {
    skipShadow: false,
    skipShips: false,
    skipBloom: false,
    freezeOcean: false,
    skipOceanDraw: false,
    skipSkyDraw: false,
    skipClouds: false,
    skipTerrain: false,
    shipDetail: 0,
    shipDiscard: false,
    shipParts: 0,
    skipFx: false,
    oceanWholeCircle: false,
  };
  /** Gunnery spectacle: muzzle blasts, splashes, bursts, tracers. */
  readonly fx: Effects;
  /** Time (s) the ocean and clouds are drawn at: the simulation clock, unless `frozenTime` pins it for screenshots. */
  time = 0;
  frozenTime: number | null = null;
  /** How fast the smoke, spray and flames of the picture run against the clock: a replay in slow motion runs them slow. */
  fxTimeScale = 1;

  private readonly context: GPUCanvasContext;
  private readonly scene = new SceneBlock();
  private readonly sceneBuffer: GPUBuffer;
  private msaaColor: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  /** Views of the two, made once per resize rather than once per frame. */
  private msaaView: GPUTextureView | null = null;
  private depthView: GPUTextureView | null = null;
  private width = 1;
  private height = 1;
  private lastSun = { elev: Number.NaN, az: Number.NaN };
  private sunIrr: [number, number, number] = [0, 0, 0];
  private cloudSun: [number, number, number] = [0, 0, 0];
  private skyDirty = true;
  private frameCounter = 0;
  private readonly timer: GpuTimer | null;
  private readonly shadowMatrix = new Float32Array(16);
  private readonly wakeSources: WakeSource[] = [];
  private readonly wakeSink: VertexSink;
  private surf: SurfLines | null = null;

  private constructor(
    private readonly gpu: GpuContext,
    canvas: HTMLCanvasElement,
    private readonly quality: SeaQuality,
    private readonly atmosphere: Atmosphere,
    private readonly field: OceanField,
    private readonly surface: OceanSurface,
    private readonly post: PostProcess,
    private readonly shadow: ShadowMap,
    private readonly ships: ShipRenderer,
    private readonly wake: WakeRibbons,
    private readonly land: TerrainRenderer,
    private readonly particles: ParticleSystem,
    sceneBuffer: GPUBuffer,
    params: SeaParams,
  ) {
    this.params = params;
    this.fx = new Effects(particles);
    particles.seaHeight = (x, z) => this.waveHeightAt(x, z);
    this.sceneBuffer = sceneBuffer;
    this.wakeSink = new VertexSink(wake.staging);
    this.timer = GpuTimer.create(gpu.device);
    Object.defineProperty(this.buoyancyWaves, 'modes', { get: () => this.field.waveModes });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not acquire a webgpu canvas context');
    this.context = context;
    this.context.configure({ device: gpu.device, format: gpu.canvasFormat, alphaMode: 'opaque' });
  }

  static async create(
    gpu: GpuContext,
    canvas: HTMLCanvasElement,
    quality: SeaQuality,
    params: SeaParams = DEFAULT_SEA,
  ): Promise<SeaRenderer> {
    const { device } = gpu;
    const sceneBuffer = device.createBuffer({
      label: 'scene',
      size: SCENE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const atmosphere = await Atmosphere.create({
      device,
      sceneBuffer,
      colorFormat: HDR_FORMAT,
      depthFormat: DEPTH_FORMAT,
      sampleCount: quality.msaa,
    });
    const field = await OceanField.create({ device, size: quality.oceanSize, lengths: CASCADE_LENGTHS });
    const shadow = new ShadowMap(device, quality.shadowSize);
    const weathering = await loadWeathering(device);
    const ships = await ShipRenderer.create({
      device,
      sceneBuffer,
      skyView: atmosphere.skyView,
      cloudLut: atmosphere.cloudLut,
      envSampler: atmosphere.envSampler,
      shadow,
      weathering,
      colorFormat: HDR_FORMAT,
      depthFormat: DEPTH_FORMAT,
      sampleCount: quality.msaa,
    });
    const surface = await OceanSurface.create({
      device,
      sceneBuffer,
      field,
      skyView: atmosphere.skyView,
      cloudLut: atmosphere.cloudLut,
      envSampler: atmosphere.envSampler,
      noiseView: atmosphere.noiseView,
      noiseSampler: atmosphere.noiseSampler,
      shadow,
      colorFormat: HDR_FORMAT,
      depthFormat: DEPTH_FORMAT,
      sampleCount: quality.msaa,
      anisotropy: quality.anisotropy,
    });
    const wake = await WakeRibbons.create({
      device,
      sceneBuffer,
      field,
      skyView: atmosphere.skyView,
      envSampler: atmosphere.envSampler,
      noiseView: atmosphere.noiseView,
      noiseSampler: atmosphere.noiseSampler,
      colorFormat: HDR_FORMAT,
      depthFormat: DEPTH_FORMAT,
      sampleCount: quality.msaa,
    });
    const land = await TerrainRenderer.create({
      device,
      sceneBuffer,
      skyView: atmosphere.skyView,
      envSampler: atmosphere.envSampler,
      noiseView: atmosphere.noiseView,
      noiseSampler: atmosphere.noiseSampler,
      colorFormat: HDR_FORMAT,
      depthFormat: DEPTH_FORMAT,
      sampleCount: quality.msaa,
    });
    const particles = await ParticleSystem.create({
      device,
      sceneBuffer,
      skyView: atmosphere.skyView,
      envSampler: atmosphere.envSampler,
      noiseView: atmosphere.noiseView,
      noiseSampler: atmosphere.noiseSampler,
      colorFormat: HDR_FORMAT,
      depthFormat: DEPTH_FORMAT,
      sampleCount: quality.msaa,
    });
    const post = await PostProcess.create(device, gpu.canvasFormat);
    const renderer = new SeaRenderer(
      gpu,
      canvas,
      quality,
      atmosphere,
      field,
      surface,
      post,
      shadow,
      ships,
      wake,
      land,
      particles,
      sceneBuffer,
      { ...params },
    );
    renderer.regenerateSea();
    return renderer;
  }

  /** Re-seed the wave spectra from the current wind settings (call after changing wind, heading, fetch, seed). */
  regenerateSea(): void {
    const p = this.params;
    this.field.setSea(
      {
        windSpeed: p.windSpeed,
        waveDirRad: compassToWaveDir(p.waveHeadingDeg),
        fetchM: p.fetchKm * 1000,
        gamma: 3.3,
      },
      p.seed,
    );
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.msaaColor?.destroy();
    this.depth?.destroy();
    const sampleCount = this.quality.msaa;
    this.msaaColor =
      sampleCount > 1
        ? this.gpu.device.createTexture({
            label: 'scene-color-msaa',
            size: [width, height],
            format: HDR_FORMAT,
            sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
        : null;
    this.depth = this.gpu.device.createTexture({
      label: 'scene-depth',
      size: [width, height],
      format: DEPTH_FORMAT,
      sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaView = this.msaaColor?.createView() ?? null;
    this.depthView = this.depth.createView();
    this.post.resize(width, height);
  }

  /** The arc of the sea's grid drawn this frame (segments of 384), and the share of its vertices that is. */
  get oceanArc(): { from: number; count: number; drawnFraction: number } {
    return { ...this.surface.arc, drawnFraction: this.surface.drawnFraction };
  }

  /** Smoothed GPU milliseconds per phase, or null when the device has no timestamp queries. */
  get gpuTimes(): GpuTimes | null {
    return this.timer ? this.timer.times : null;
  }

  addWake(source: WakeSource): void {
    this.wakeSources.push(source);
  }

  removeWake(source: WakeSource): void {
    const i = this.wakeSources.indexOf(source);
    if (i >= 0) this.wakeSources.splice(i, 1);
  }

  /** Put land in the world (or take it away with null): the meshes are built and the shoreline's surf laid out. */
  setTerrain(terrain: Terrain | null): void {
    this.land.setTerrain(terrain);
    this.surf = terrain ? new SurfLines(terrain) : null;
  }

  /** What the land cost in the last frame: tiles and triangles drawn. */
  get landStats(): { tiles: number; triangles: number } {
    return { tiles: this.land.tilesDrawn, triangles: this.land.trianglesDrawn };
  }

  addShip(model: ShipModel): ShipInstance {
    return this.ships.add(model);
  }

  /** The second half of a ship that is about to break in two (see ShipInstance.parent). */
  addShipSection(parent: ShipInstance): ShipInstance {
    return this.ships.addSection(parent);
  }

  /** Water surface height (m) at a world position, from the same long waves the GPU renders. */
  waveHeightAt(x: number, z: number): number {
    return heightFromModes(this.field.waveModes, x, z, this.time);
  }

  /** The same, at a given moment of the clock: the simulation floats the ships at the time of its own step, not the frame's. */
  waveHeightAtTime(x: number, z: number, t: number): number {
    return heightFromModes(this.field.waveModes, x, z, t);
  }

  /** The moment of the waves a ship floats on at simulation time `simTime`: that time, unless the sea is pinned for a picture, when it is the pinned one. */
  waveTime(simTime: number): number {
    return this.frozenTime ?? simTime;
  }

  /** The long waves the ships float on, as the sea has them now (re-seeding the sea replaces them). */
  readonly buoyancyWaves: { readonly modes: readonly import('../sim/ocean/spectrum').WaveMode[] } = {
    modes: [],
  };

  /** Significant wave height estimate (m) used only for shading; the real field comes from the spectrum. */
  private estimateHs(): number {
    const { windSpeed: u, fetchKm } = this.params;
    const fetchLimited = 0.0016 * u * Math.sqrt((fetchKm * 1000) / 9.81);
    return Math.min(fetchLimited, 0.0246 * u * u);
  }

  frame(dtSeconds: number, camera: Camera): void {
    const { device } = this.gpu;
    const p = this.params;
    // The sea keeps the simulation's clock (unless pinned for a picture): the ships float on it at their steps, so the waves drawn
    // must be the waves they were floated on, and a slowed or hurried game slows or hurries its sea with it.
    const now = this.frozenTime ?? this.simTime;
    const seaDt = Math.max(now - this.time, 0);
    this.time = now;
    const loopedTime = this.time % OCEAN_LOOP_SECONDS;

    // Sun.
    const e = degToRad(p.sunElevationDeg);
    const a = degToRad(p.sunAzimuthDeg);
    const sunDir: [number, number, number] = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
    if (p.sunElevationDeg !== this.lastSun.elev || p.sunAzimuthDeg !== this.lastSun.az) {
      this.lastSun = { elev: p.sunElevationDeg, az: p.sunAzimuthDeg };
      this.sunIrr = sunlightAt(2, p.sunElevationDeg);
      this.cloudSun = sunlightAt(p.cloudAltitudeM, p.sunElevationDeg);
      this.skyDirty = true;
    }
    const exposure = BASE_EXPOSURE * 2 ** (exposureStops(p.sunElevationDeg) + p.exposureBias);

    // Scene uniform.
    const s = this.scene;
    const tanY = camera.tanHalfFovY;
    s.mat4(SLOT.viewProj, camera.viewProj);
    s.vec4(SLOT.camRight, ...camera.right, tanY * camera.aspect);
    s.vec4(SLOT.camUp, ...camera.up, tanY);
    s.vec4(SLOT.camFwd, ...camera.forward, camera.near);
    s.vec4(SLOT.camPos, camera.position[0], camera.position[1], camera.position[2], loopedTime);
    s.vec4(SLOT.sunDir, ...sunDir, SUN_ANGULAR_RADIUS);
    s.vec4(SLOT.sunIrr, ...this.sunIrr, exposure);
    s.vec4(SLOT.screen, this.width, this.height, 1 / this.width, 1 / this.height);
    s.vec4(SLOT.ocean, p.choppiness, this.estimateHs(), 0, p.visibilityKm);
    this.field
      .cascadeUniforms(camera.position[0], camera.position[2])
      .forEach((row, i) => s.vec4(SLOT.cascade + i, ...row));
    const drift = p.cloudDriftMs * this.time;
    const heading = degToRad(p.waveHeadingDeg);
    s.vec4(SLOT.cloud, p.cloudCover, p.cloudAltitudeM, Math.sin(heading) * drift, -Math.cos(heading) * drift);
    s.vec4(SLOT.cloudSun, ...this.cloudSun, 0);
    s.vec4(SLOT.atmo, Math.sin(e), 1, 0, 0);

    // Sun shadow framed on the first ship that is drawn (the player's, or the one at anchor at the front door). Off when the sun is down
    // or there is no ship.
    const focus = this.ships.ships.find((s) => s.visible);
    const drawShips = !this.debug.skipShips;
    const shadowOn = drawShips && !this.debug.skipShadow && focus !== undefined && sunDir[1] > 0.02;
    if (shadowOn) {
      const half = Math.max(focus.shipModel.length * 0.62, 90);
      const target: Vec3 = [focus.pose.x, focus.pose.heave + 6, focus.pose.z];
      sunShadowMatrix(sunDir, target, camera.position, half, 220, this.shadow.size, this.shadowMatrix);
      s.mat4(SLOT.shadowViewProj, this.shadowMatrix);
      const texelWorld = (2 * half) / this.shadow.size;
      s.vec4(SLOT.shadow, 1, 1 / this.shadow.size, texelWorld * 2.5, 0.0006);
    } else {
      s.vec4(SLOT.shadow, 0, 1 / this.shadow.size, 0, 0);
    }
    // Wakes: rebuild every ribbon this frame, relative to the camera.
    const sink = this.wakeSink;
    sink.reset();
    sink.originX = camera.position[0];
    sink.originZ = camera.position[2];
    for (const src of this.wakeSources) {
      const st = src.state();
      if (Math.hypot(st.x - camera.position[0], st.z - camera.position[2]) > WAKE_RANGE_M) continue;
      buildWake(sink, src.history, this.simTime, src.ship);
      buildHullFoam(sink, st.x, st.z, st.headingDeg, {
        length: src.hull.length,
        halfBreadthAt: src.hull.halfBreadthAt,
        speedFraction: Math.min(Math.abs(st.speed) / src.ship.referenceSpeed, 1),
      });
    }
    if (this.surf && !this.debug.skipTerrain) this.surf.emit(sink, camera.position[0], camera.position[2], SURF_RANGE_M, this.time);
    this.wake.setVertices(sink.count);

    device.queue.writeBuffer(this.sceneBuffer, 0, s.data, 0, SCENE_UPLOAD_FLOATS);
    this.ships.update(camera.position, this.simTime, this.debug.shipDetail);
    this.land.update(camera);
    const drawFx = !this.debug.skipFx;
    if (drawFx) {
      this.particles.update(dtSeconds * this.fxTimeScale);
      this.particles.prepare(camera.position[0], camera.position[1], camera.position[2]);
    }

    // The sea's grid is drawn only where the camera can see it: the arc of its view, and the whole of the near sea. The waves' rise
    // and sideways carry are bounded generously from the significant wave height.
    const hs = this.estimateHs();
    this.surface.setView(camera, hs + 1, (hs + 1) * p.choppiness + 1, this.debug.oceanWholeCircle);

    const encoder = device.createCommandEncoder({ label: 'frame' });

    const refreshClouds = !this.debug.skipClouds && this.frameCounter % CLOUD_REFRESH_FRAMES === 0;
    if (this.skyDirty || refreshClouds) {
      const skyPass = encoder.beginComputePass({ label: 'sky', timestampWrites: this.timer?.compute('sky') });
      if (this.skyDirty) {
        this.atmosphere.encodeSkyView(skyPass);
        this.skyDirty = false;
      }
      if (refreshClouds) this.atmosphere.encodeCloudsAndAmbient(skyPass);
      skyPass.end();
    }
    if (!this.debug.freezeOcean) {
      const oceanPass = encoder.beginComputePass({ label: 'ocean', timestampWrites: this.timer?.compute('ocean') });
      this.field.encode(oceanPass, loopedTime, p.choppiness, FOAM, seaDt);
      oceanPass.end();
    }
    encoder.copyBufferToBuffer(this.atmosphere.ambientBuffer, 0, this.sceneBuffer, SCENE_AMBIENT_BYTE_OFFSET, 16);

    if (shadowOn) {
      const shadowPass = encoder.beginRenderPass({
        label: 'sun-shadow',
        colorAttachments: [],
        timestampWrites: this.timer?.render('shadow'),
        depthStencilAttachment: {
          view: this.shadow.view,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      this.ships.drawShadow(shadowPass);
      shadowPass.end();
    }

    const hdrView = this.post.hdrView;
    const msaa = this.msaaColor;
    const pass = encoder.beginRenderPass({
      label: 'scene',
      timestampWrites: this.timer?.render('scene'),
      colorAttachments: [
        {
          view: msaa ? this.msaaView! : hdrView,
          resolveTarget: msaa ? hdrView : undefined,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: msaa ? 'discard' : 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    if (!this.debug.skipSkyDraw) this.atmosphere.drawSky(pass);
    if (!this.debug.skipOceanDraw) this.surface.draw(pass);
    if (!this.debug.skipTerrain) this.land.draw(pass);
    if (drawShips) this.ships.draw(pass, this.debug.shipDiscard, this.debug.shipParts);
    // The foam is blended over the sea after everything solid: it is tested against the hulls' and the land's depth, so none of it is
    // drawn where a ship or a shore stands in front of it, and on a tile-based GPU the sea under a hull is never shaded for nothing.
    this.wake.draw(pass);
    if (drawFx) this.particles.draw(pass);
    pass.end();

    this.post.encode(encoder, this.context.getCurrentTexture().createView(), exposure, p.bloom, this.timer, !this.debug.skipBloom);
    this.timer?.resolve(encoder);
    device.queue.submit([encoder.finish()]);
    this.timer?.afterSubmit();
    this.frameCounter++;

  }
}
