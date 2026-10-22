import './style.css';
import { CAMERA_PRESETS, shipToWorld } from './app/camera-presets';
import { ChaseCamera } from './app/chase-camera';
import { FreeCamera } from './app/free-camera';
import { PerfSurvey } from './app/perf-survey';
import { Campaign, type Recorded } from './campaign/campaign';
import { missionById, practiceById, type MissionDef } from './campaign/missions';
import { isShipId, shipById, type ShipId } from './data/ships/roster';
import { buildShip } from './render/ships/forge/build-ship';
import type { ShipInstance } from './render/ships/ship-renderer';
import { narrowsTerrain, NARROWS_START } from './data/missions/narrows';
import { DEFAULT_SCENARIO, DESTROYER_SCENARIO, Game, NARROWS_SCENARIO, type ScenarioParams } from './app/game';
import type { PlayerShip } from './app/player-ship';
import { SightCamera } from './app/sight-camera';
import { Tutorial } from './app/tutorial';
import { GamepadSource } from './input/gamepad';
import { createIntent, type InputDevice } from './input/intent';
import { KeyboardSource } from './input/keyboard-mouse';
import { InputManager } from './input/manager';
import { PointerCameraSource } from './input/pointer-camera';
import { initGpu, type GpuInitResult } from './platform/gpu-device';
import { runProbe } from './platform/probe';
import { CanvasSizer } from './platform/resize';
import { Camera } from './render/camera';
import { runOceanSelfTest } from './render/ocean/ocean-selftest';
import { RenderScaleController } from './render/render-scale';
import { DEFAULT_SEA, SeaRenderer, type SeaParams } from './render/sea-renderer';
import { FixedStepper } from './sim/time';
import { DebugOverlay } from './ui/debug-overlay';
import { BattleHud } from './ui/battle-hud';
import { CampaignMenu } from './ui/campaign-menu';
import { GunneryHud } from './ui/gunnery-hud';
import { GunneryWidgets } from './ui/gunnery-widgets';
import { HelmHud } from './ui/helm-hud';
import { HelmWidgets } from './ui/helm-widgets';
import { SeaControls } from './ui/sea-controls';
import { TacticalPlot } from './ui/tactical-plot';
import { TorpedoHud } from './ui/torpedo-hud';
import { TutorialHud } from './ui/tutorial-hud';

const SIM_HZ = 60;
/** Parameters that do not choose a scenario: a URL with only these opens the front door. */
const MENU_PARAMS = new Set(['touch', 'debug', 'aniso', 'q', 'msaa', 'scale', 'shadow', 'menu']);

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The page's own URL with only its cosmetic parameters, and a sortie if there is one (null: the front door). */
function menuUrl(q: URLSearchParams, missionId: string | null, seed?: number, practice = false): string {
  const u = new URL(location.href);
  u.search = '';
  for (const k of MENU_PARAMS) if (q.has(k) && k !== 'menu') u.searchParams.set(k, q.get(k)!);
  if (missionId) {
    u.searchParams.set(practice ? 'practice' : 'mission', missionId);
    if (seed !== undefined) u.searchParams.set('gseed', String(seed));
  } else u.searchParams.set('menu', '1');
  return u.toString();
}
/** Starting pixel budget; the render-scale controller adapts from here. */
const MAX_PIXELS = 3_600_000;

declare global {
  interface Window {
    __sea?: SeaRenderer;
    __player?: PlayerShip;
    __game?: Game;
    __sight?: SightCamera;
    __camera?: Camera;
    __campaign?: Campaign;
    __tutorial?: Tutorial;
    __terrain?: import('./sim/terrain/terrain').Terrain;
    __oceanSelfTest?: () => ReturnType<typeof runOceanSelfTest>;
    __frames?: number;
    __survey?: import('./app/perf-survey').SurveyRow[];
    __gpuTiming?: () => import('./render/gpu-timer').GpuTimes | null;
  }
}

function showUnsupported(failure: Extract<GpuInitResult, { ok: false }>): void {
  document.body.innerHTML = `
    <main class="unsupported">
      <h1>Fall of Shot</h1>
      <p>${failure.message}</p>
      <p><small>${failure.reason}</small></p>
    </main>`;
}

/** URL parameters make screenshots and device comparisons reproducible: ?sun=6&az=250&wind=12&clouds=0.5 ... */
function readParams(q: URLSearchParams): { sea: SeaParams; camera: Camera; num: (key: string, fallback: number) => number } {
  const num = (key: string, fallback: number) => (q.has(key) && Number.isFinite(Number(q.get(key))) ? Number(q.get(key)) : fallback);
  const sea: SeaParams = {
    ...DEFAULT_SEA,
    sunElevationDeg: num('sun', DEFAULT_SEA.sunElevationDeg),
    sunAzimuthDeg: num('az', DEFAULT_SEA.sunAzimuthDeg),
    windSpeed: num('wind', DEFAULT_SEA.windSpeed),
    waveHeadingDeg: num('heading', DEFAULT_SEA.waveHeadingDeg),
    cloudCover: num('clouds', DEFAULT_SEA.cloudCover),
    visibilityKm: num('vis', DEFAULT_SEA.visibilityKm),
    exposureBias: num('exp', DEFAULT_SEA.exposureBias),
    choppiness: num('chop', DEFAULT_SEA.choppiness),
    bloom: num('bloom', DEFAULT_SEA.bloom),
    seed: num('seed', DEFAULT_SEA.seed),
  };
  const camera = new Camera();
  camera.position = [num('x', 0), num('cam', 28), num('z', 0)];
  camera.yawDeg = num('yaw', sea.sunAzimuthDeg);
  camera.pitchDeg = num('pitch', 3);
  camera.fovYDeg = num('fov', 60);
  return { sea, camera, num };
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#gfx');
  const overlayRoot = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlayRoot) throw new Error('index.html is missing #gfx or #overlay');
  const q = new URLSearchParams(location.search);
  // A sortie's own settings (the enemy, the weather) stand under whatever the player's URL says.
  const sortie = missionById(q.get('mission'));
  // ?practice=gunnery-school is the coached course: a target that does not fire back, and a card that says what to do.
  const practice = practiceById(q.get('practice'));
  for (const [k, v] of Object.entries((sortie ?? practice)?.params ?? {})) if (!q.has(k)) q.set(k, v);
  if (q.get('hud') === '0') overlayRoot.hidden = true;

  const overlay = new DebugOverlay(overlayRoot, q.get('debug') === '1');
  const init = await initGpu((reason) => overlay.setStats(`GPU device lost (${reason}). Reload the page.`));
  if (!init.ok) {
    showUnsupported(init);
    return;
  }
  const { gpu } = init;
  window.__oceanSelfTest = () => runOceanSelfTest(gpu.device);

  const { sea: seaParams, camera, num } = readParams(q);
  const oceanSize = q.get('q') === 'B' ? 128 : 256;
  const msaa = q.get('msaa') === '1' ? 1 : 4;
  const shadowSize = q.get('shadow') === '4096' ? 4096 : 2048;
  const aniso = q.get('aniso') === '1' ? 1 : q.get('aniso') === '2' ? 2 : 4;
  const sea = await SeaRenderer.create(gpu, canvas, { oceanSize, msaa, shadowSize, anisotropy: aniso }, seaParams);
  window.__sea = sea;
  window.__camera = camera;
  // ?terrain=narrows puts the Narrows' land in the world without the fight (the mission scenario does it itself).
  if (q.get('terrain') === 'narrows' && q.get('scenario') !== 'narrows') {
    const land = narrowsTerrain();
    window.__terrain = land;
    sea.setTerrain(land);
  }
  window.__gpuTiming = () => sea.gpuTimes;
  if (q.has('freeze')) sea.frozenTime = Number(q.get('freeze'));

  const fixedScale = q.has('scale') ? Number(q.get('scale')) : null;
  const sizer = new CanvasSizer(canvas, gpu.device.limits.maxTextureDimension2D, (w, h) => sea.resize(w, h), MAX_PIXELS);
  if (fixedScale !== null) sizer.renderScale = fixedScale;
  const scaler = new RenderScaleController(0.5, 1, 1);

  // ---- the ship and how it is controlled --------------------------------------------------------
  const wantShip = q.get('ship') !== '0';
  const freeCam = q.get('free') === '1' || !wantShip;
  // ?passive=1 makes the enemy a gunnery-practice target that steams a plan and never fires back.
  // ?scenario=destroyers&dd=2 is a torpedo attack by that many destroyers instead of the duel.
  // The campaign: ?mission=<id> starts a sortie with the dockyard's refits; a bare URL opens the front door. ?scenario= is the
  // plain scenario with the ship as built (tests and tuning).
  const campaign = new Campaign(safeStorage());
  window.__campaign = campaign;
  const mission = sortie;
  const menuMode = !mission && (q.get('menu') === '1' || [...q.keys()].every((k) => MENU_PARAMS.has(k)));
  const scenarioName = q.get('scenario') ?? mission?.scenario ?? 'duel';
  const attack = scenarioName === 'destroyers';
  // ?scenario=narrows is the shore mission: batteries, mines, shoals and the spotter aircraft.
  const narrows = scenarioName === 'narrows';
  const defaults = narrows ? NARROWS_SCENARIO : attack ? DESTROYER_SCENARIO : DEFAULT_SCENARIO;
  const scenario: ScenarioParams | null =
    wantShip && q.get('target') !== '0' && !menuMode
      ? {
          kind: narrows ? 'narrows' : attack ? 'destroyers' : 'duel',
          destroyers: Math.round(num('dd', DESTROYER_SCENARIO.destroyers ?? 2)),
          foe: isShipId(q.get('foe')) ? (q.get('foe') as ShipId) : undefined,
          escorts: Math.round(num('esc', 0)),
          rangeKm: num('trange', defaults.rangeKm),
          bearingDeg: num('tbrg', defaults.bearingDeg),
          headingDeg: q.has('thdg') ? num('thdg', 0) : undefined,
          plan:
            q.get('passive') === '1'
              ? {
                  courseDeg: num('tcrs', 20),
                  speedKn: num('tspd', 6),
                  zigzagDeg: num('tzig', 0),
                  zigzagPeriodS: num('tzigp', 90),
                }
              : null,
        }
      : null;
  const autoPlayer = q.get('auto') === 'steady' ? 'steady' : q.get('auto') === 'closing' ? 'closing' : q.get('auto') === 'evade' ? 'evade' : null;
  const game = wantShip
    ? new Game(sea, scenario, { seed: num('gseed', 1914), autoPlayer, refits: mission ? campaign.levels : undefined, objective: (mission ?? practice)?.objective, practice: practice !== null, player: isShipId(q.get('player')) ? (q.get('player') as ShipId) : mission?.ship })
    : null;
  const player = game?.player ?? null;
  if (game && player) {
    window.__game = game;
    window.__player = player;
    const start = narrows ? NARROWS_START : { x: 0, z: 0, headingDeg: 0 };
    player.setPosition(num('px', start.x), num('pz', start.z), num('hdg', start.headingDeg));
    if (scenario && !narrows) game.placeEnemy(scenario);
    if (q.has('tele')) player.dynamics.setTelegraph(num('tele', 0));
    if (q.has('rud')) {
      player.dynamics.setRudderOrder(num('rud', 0));
      player.dynamics.rudder = player.dynamics.rudderOrder;
    }
    if (q.get('designate') === '1' && game.targets[0]) game.gunnery.designate(game.targets[0]);
    if (q.get('autospot') === '1') game.gunnery.autoSpot = true;
    if (q.get('tracers') === '0') sea.fx.tracers = false;
  }

  const touchCapable = q.get('touch') === '1' || (navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches);
  const initialDevice: InputDevice = touchCapable ? 'touch' : 'keyboard-mouse';
  document.body.dataset.input = initialDevice;
  const widgets = new HelmWidgets(overlayRoot);
  const gunWidgets = game ? new GunneryWidgets(overlayRoot) : null;
  const hud = new HelmHud(overlayRoot);
  hud.setDevice(initialDevice);
  const gunHud = game ? new GunneryHud(overlayRoot) : null;
  gunHud?.setDevice(initialDevice);
  const torpedoHud = game ? new TorpedoHud(overlayRoot) : null;
  torpedoHud?.setDevice(initialDevice);
  // Gunnery School: a coach that watches what the player does and says what to do next.
  const tutorial = game && practice ? new Tutorial() : null;
  if (tutorial) window.__tutorial = tutorial;
  document.body.dataset.tutorial = tutorial ? '1' : '0';
  const tutorialHud = tutorial
    ? new TutorialHud(overlayRoot, {
        next: () => tutorial.next(),
        exit: () => (location.href = menuUrl(q, null)),
        sortie: () => (location.href = menuUrl(q, 'trials', 1914)),
        stay: () => tutorial.finish(),
      })
    : null;
  // The chart table is up from the start in a torpedo attack, and one key away otherwise.
  const plot = game ? new TacticalPlot(overlayRoot) : null;
  if (plot) {
    plot.visible = attack || narrows || num('esc', 0) > 0 || q.get('plot') === '1';
    // A bombardment is fought at ten kilometres; a torpedo attack at three.
    if (narrows) plot.setRadius(12000);
  }
  let damagePanelOpen = false;
  const battleHud = game
    ? new BattleHud(
        overlayRoot,
        () => {
          // Fight again: the same scenario with the next seed.
          const u = new URL(location.href);
          u.searchParams.set('gseed', String(num('gseed', 1914) + 1));
          location.href = u.toString();
        },
        () => (damagePanelOpen = !damagePanelOpen),
        () => {
          // Return to port: the front door, with the cosmetic parameters carried over.
          location.href = menuUrl(q, null);
        },
      )
    : null;
  // The front door, in front of the ship at anchor.
  const chase = new ChaseCamera(camera);
  // At the front door the ship at anchor is the one the chosen sortie gives her: each is built once, the others hidden.
  const anchored = new Map<ShipId, ShipInstance>();
  let anchoredNow: ShipId | null = null;
  const showAnchored = (id: ShipId): void => {
    if (!game || id === anchoredNow) return;
    const entry = shipById(id);
    let instance = anchored.get(id);
    if (!instance) {
      instance = sea.addShip(buildShip(entry.spec));
      if (entry.paint) instance.paint = { ...instance.paint, ...entry.paint };
      anchored.set(id, instance);
    }
    for (const [other, inst] of anchored) inst.visible = other === id;
    game.player.instance.visible = false;
    anchoredNow = id;
  };
  const menu = menuMode
    ? new CampaignMenu(
        overlayRoot,
        campaign,
        (m: MissionDef) => {
          location.href = m.practice ? menuUrl(q, m.id, 1914, true) : menuUrl(q, m.id, 1914 + (campaign.state.missions[m.id]?.attempts ?? 0));
        },
        (m: MissionDef) => {
          const ship = shipById(m.ship);
          showAnchored(ship.id);
          // Stand off far enough to see the whole of her.
          chase.distance = Math.max(230, ship.spec.hull.length * 1.35);
        },
      )
    : null;
  document.body.dataset.menu = menu ? '1' : '0';
  const idleIntent = createIntent();
  let recorded: Recorded | null = null;
  const sight = new SightCamera();
  window.__sight = sight;
  const baseFov = camera.fovYDeg;
  const input = new InputManager(
    [
      new KeyboardSource(window),
      new PointerCameraSource('keyboard-mouse', 'mouse', canvas, () => ({ width: canvas.clientWidth, height: canvas.clientHeight })),
      new GamepadSource(),
      new PointerCameraSource('touch', 'touch', canvas, () => ({ width: canvas.clientWidth, height: canvas.clientHeight })),
      widgets,
      ...(gunWidgets ? [gunWidgets] : []),
    ],
    initialDevice,
  );
  input.onDeviceChange((device) => {
    document.body.dataset.input = device;
    hud.setDevice(device);
    gunHud?.setDevice(device);
    torpedoHud?.setDevice(device);
  });

  // ?tscale=N runs the simulation N times faster than the clock (tests, demos, impatience).
  let tscale = Math.min(Math.max(num('tscale', 1), 0.1), 20);
  const stepper = new FixedStepper(1 / SIM_HZ, 5 * 20, 0.25 * 20);
  // ?sightup=1 holds the director's sight up (screenshots and tests).
  const forceSight = q.get('sightup') === '1';
  if (q.has('orbit')) {
    const [yaw, pitch, dist] = (q.get('orbit') ?? '').split(',').map(Number);
    if (Number.isFinite(yaw)) chase.orbitDeg = yaw!;
    if (Number.isFinite(pitch)) chase.pitchDeg = pitch!;
    if (Number.isFinite(dist)) chase.distance = dist!;
  } else if (game) {
    // A longer ship wants the camera further off.
    chase.distance = Math.max(chase.distance, game.playerEntry.spec.hull.length * 1.35);
  }
  const freeCamera = freeCam ? new FreeCamera(camera, canvas) : null;
  const controls = new SeaControls(overlayRoot, sea.params, camera, () => sea.regenerateSea());
  if (player) {
    if (game && scenario) {
      // Duel, then the torpedo attack, then the Narrows, then round again.
      const next = narrows ? null : attack ? 'narrows' : 'destroyers';
      controls.addButton(narrows ? 'Switch to the duel' : attack ? 'Switch to the Narrows' : 'Switch to the torpedo attack', () => {
        const u = new URL(location.href);
        if (next) u.searchParams.set('scenario', next);
        else u.searchParams.delete('scenario');
        location.href = u.toString();
      });
    }
    controls.addButton('Fire salvo', () => player.fire());
    // Closing from 12 km takes minutes at the real rate: let the clock run faster while nothing needs a steady hand.
    controls.addSlider('Time scale', 1, 10, 1, () => tscale, (v) => (tscale = v), (v) => `x${v.toFixed(0)}`);
    if (game) controls.addToggle('Tracers', (on) => (sea.fx.tracers = on), sea.fx.tracers);
    controls.addToggle('Sweep turrets', (on) => (player.sweep = on));
    controls.addToggle('Wheel returns to midships (touch)', (on) => (widgets.autoCenter = on), true);
    if (freeCam) {
      const aim = (i: number) => {
        const preset = CAMERA_PRESETS[i]!;
        const [x, y, z] = shipToWorld(preset.at);
        camera.position = [x, y, z];
        const [lx, ly, lz] = shipToWorld(preset.look);
        camera.lookAt(lx, ly, lz);
      };
      const shot = Number(q.get('shot') ?? 0);
      if (!q.has('yaw') && !q.has('x')) aim(Number.isFinite(shot) ? shot : 0);
      CAMERA_PRESETS.forEach((p, i) => controls.addButton(p.name, () => aim(i)));
    }
    if (q.get('sweep') === '1') player.sweep = true;
    if (q.has('aim')) {
      const [train, elev] = (q.get('aim') ?? '0,0').split(',').map(Number);
      player.hold = { trainDeg: train ?? 0, elevDeg: elev ?? 0 };
    }
    if (q.has('fire')) window.setTimeout(() => player.fire(), Number(q.get('fire')) * 1000);
  }

  // Pre-run the simulation so a wake is already trailing astern (screenshots, quick demos): ?warm=<seconds>.
  let simTime = 0;
  if (game && player && q.has('warm')) {
    const idle = createIntent();
    const fireFrom = q.has('warmfire') ? num('warmfire', 0) : Number.POSITIVE_INFINITY;
    for (let t = 0; t < num('warm', 0); t += 1 / SIM_HZ) {
      simTime += 1 / SIM_HZ;
      idle.fire = t >= fireFrom;
      game.step(1 / SIM_HZ, idle, simTime);
    }
    game.updateRender(1, 0);
  }

  // ---- probe and survey -------------------------------------------------------------------------
  let tick = 0;
  let paused = false;
  let probing = false;
  const startProbe = async () => {
    if (probing) return;
    probing = true;
    overlay.setProbeRunning(true);
    overlay.resetProbeLog();
    try {
      // Rendering is paused while probing: a running scene would contaminate the timings.
      await gpu.device.queue.onSubmittedWorkDone();
      const test = await runOceanSelfTest(gpu.device);
      overlay.appendProbeLog(`${test.ok ? 'PASS' : 'FAIL'} ocean-field self-test: ${test.detail}`);
      const report = await runProbe(gpu, (line) => overlay.appendProbeLog(line));
      overlay.showProbeJson(JSON.stringify(report, null, 2));
    } catch (err) {
      overlay.appendProbeLog(`probe crashed: ${String(err)}`);
    } finally {
      probing = false;
      overlay.setProbeRunning(false);
    }
  };
  overlay.onProbe(() => void startProbe());
  if (q.has('probe')) void startProbe();

  // Per-feature cost survey: fixed resolution, one configuration at a time. The scaler stands down meanwhile.
  const startBattle = () => {
    if (!game) return;
    // Two broadsides' worth of blasts around the ship, and a field of splashes and bursts ahead of the camera.
    const f = game.player.frame;
    for (const t of game.gunnery.battery.turrets) {
      const m = t.mount;
      const p = [f.x + Math.sin(f.heading) * m.axis[0] + Math.cos(f.heading) * m.axis[2], 12, f.z - Math.cos(f.heading) * m.axis[0] + Math.sin(f.heading) * m.axis[2]] as const;
      sea.fx.muzzleBlast([p[0], p[1], p[2]], [Math.cos(f.heading), 0.1, Math.sin(f.heading)], 0.305);
    }
    const cam = camera.position;
    for (let i = 0; i < 10; i++) {
      const a = camera.yawDeg * (Math.PI / 180) + (i - 4.5) * 0.12;
      const d = 300 + i * 140;
      sea.fx.shellSplash(cam[0] + Math.sin(a) * d, cam[2] - Math.cos(a) * d, 0.305);
    }
    for (let i = 0; i < 3; i++) sea.fx.hitBurst(cam[0] + Math.sin(camera.yawDeg * (Math.PI / 180)) * (500 + i * 200), 8, cam[2] - Math.cos(camera.yawDeg * (Math.PI / 180)) * (500 + i * 200), 0.305);
  };
  const startScreen = () => {
    // A wall of smoke across the view at a few hundred metres, as a destroyer's screen looks half a minute after it is laid:
    // the clouds have spread to their widest, which is the worst case for overdraw.
    const cam = camera.position;
    const yaw = camera.yawDeg * (Math.PI / 180);
    for (let i = 0; i < 80; i++) {
      const across = (i / 79 - 0.5) * 900;
      const d = 450 + (i % 5) * 40;
      sea.fx.screenPuff(cam[0] + Math.sin(yaw) * d + Math.cos(yaw) * across, cam[2] - Math.cos(yaw) * d + Math.sin(yaw) * across, 0, 0, 45, 60, 40);
    }
  };
  const survey = new PerfSurvey(sea, (scale) => (sizer.renderScale = scale), () => sizer.width * sizer.height, startBattle, startScreen);
  const startSurvey = async () => {
    if (survey.running || probing) return;
    overlay.setSurveyRunning(true);
    overlay.resetProbeLog();
    overlay.appendProbeLog('Perf survey: do not touch the screen for about a minute.');
    try {
      const rows = await survey.run((line) => overlay.appendProbeLog(line));
      const { adapterInfo } = gpu;
      overlay.showProbeJson(
        JSON.stringify(
          {
            when: new Date().toISOString(),
            userAgent: navigator.userAgent,
            adapter: { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture },
            devicePixelRatio: window.devicePixelRatio,
            quality: { oceanSize, msaa, shadowSize },
            // What was on screen, so that the rows can be read: the scenario and how much land was in view.
            scenario: narrows ? 'narrows' : attack ? 'destroyers' : game ? 'duel' : 'none',
            land: sea.landStats,
            rows,
          },
          null,
          2,
        ),
      );
      window.__survey = rows;
    } catch (err) {
      overlay.appendProbeLog(`survey crashed: ${String(err)}`);
    } finally {
      overlay.setSurveyRunning(false);
      if (fixedScale === null) sizer.renderScale = scaler.scale;
    }
  };
  overlay.onSurvey(() => void startSurvey());
  if (q.has('survey')) void startSurvey();

  // ---- the frame loop ---------------------------------------------------------------------------
  let cpuMsPerFrame = 0;
  let last = performance.now();
  let fpsFrames = 0;
  let fpsSince = last;
  let fps = 0;
  window.__frames = 0;

  const frame = (now: number) => {
    const frameMs = now - last;
    const dt = Math.min(Math.max(frameMs / 1000, 0), 0.1);
    last = now;

    if (!probing) {
      // At the front door the ship lies at anchor and nothing the player presses steers her.
      const intent = menu ? (input.update(), idleIntent) : input.update();
      if (intent.pause) paused = !paused;
      if (controls.cycleSun) {
        sea.params.sunElevationDeg = ((sea.params.sunElevationDeg + 12 + dt * 2.5) % 72) - 12;
      }

      // Simulation: one-shot orders once, then fixed steps (held rudder keys integrate per step).
      if (forceSight) intent.sight = true;
      if (intent.toggleDamageView) damagePanelOpen = !damagePanelOpen;
      if (intent.togglePlot) plot?.toggle();
      const sightUp = intent.sight && game !== null;
      game?.applyIntent(intent, camera, sightUp);
      const steps = stepper.advance(paused ? 0 : dt * tscale);
      for (let i = 0; i < steps; i++) {
        tick++;
        simTime += 1 / SIM_HZ;
        game?.step(1 / SIM_HZ, intent, simTime);
      }
      sea.simTime = simTime;

      // Camera.
      if (game && player) {
        game.updateRender(stepper.alpha, paused ? 0 : dt);
        const pose = player.instance.pose;
        // At the front door the ship at anchor floats where the player's ship does.
        if (anchoredNow) Object.assign(anchored.get(anchoredNow)!.pose, pose);
        const target = game.gunnery.target;
        const sightOwns =
          !freeCamera &&
          sight.update(
            dt,
            camera,
            { engage: sightUp, orbit: intent.cameraOrbit, zoom: intent.cameraZoom },
            game.directorPosition(),
            target ? [target.x, 9, target.z] : null,
            pose.headingDeg,
            baseFov,
            target ? (target as { id: number }).id : null,
          );
        if (freeCamera) freeCamera.update(dt);
        else if (!sightOwns) {
          camera.fovYDeg = baseFov;
          chase.update(dt, { x: pose.x, y: pose.heave, z: pose.z, headingDeg: pose.headingDeg }, menu ? [dt * 6, 0] : intent.cameraOrbit, intent.cameraZoom);
        }
        // The HUD projects ships onto the screen, so it needs this frame's view, not last frame's.
        camera.update(canvas.clientWidth / Math.max(canvas.clientHeight, 1));
        const d = player.dynamics;
        hud.update({
          speedKnots: d.speedKnots,
          headingDeg: d.headingDeg,
          rudderDeg: d.rudderDeg,
          rudderOrderDeg: d.rudderOrder * d.handling.rudderMaxDeg,
          rudderMaxDeg: d.handling.rudderMaxDeg,
          telegraph: d.telegraph,
        });
        widgets.setTelegraph(d.telegraph);
        // A sortie that has ended is marked once, and the prestige goes to the campaign.
        if (game.outcome && mission && !recorded) {
          const o = game.outcome;
          recorded = campaign.record(mission.id, {
            result: o.result,
            how: o.how,
            seconds: o.seconds,
            shellsFired: o.shellsFired,
            hitsScored: o.hitsScored,
            hitsTaken: o.hitsTaken,
            dishonour: o.dishonour,
            condition: o.condition,
            disabled: o.disabled,
          });
        }
        battleHud?.update({
          now: game.simTime,
          messages: game.messages.recent(game.simTime),
          own: { name: game.playerCombatant.name, damage: game.playerCombatant.damage, speed: d.speed, maxSpeedKn: d.handling.maxSpeedKn },
          panelOpen: damagePanelOpen,
          outcome: game.outcome,
          prestige: mission && recorded ? { earned: recorded.score.prestige, total: recorded.prestige, lines: recorded.score.lines, base: mission.basePrestige } : null,
          threats: game.threats(),
          secondary: game.secondaryReadout(),
          shore: game.shoreStatus(),
        });
        const status = game.status();
        gunWidgets?.update(status, game.torpedoMode, game.spotterStatus());
        if (tutorial && tutorialHud && practice) {
          const frame = { status, shellsFired: game.playerCombatant.shellsFired, hitsScored: game.playerCombatant.hitsScored, sightUp: sightOwns, now: game.simTime };
          tutorial.update(frame);
          // Reaching the last card is finishing the school, whether or not the player stays to read it.
          if (tutorial.complete && !campaign.practiceDone(practice.id)) campaign.finishPractice(practice.id);
          tutorialHud.update(tutorial.view(frame, (document.body.dataset.input as InputDevice | undefined) ?? 'keyboard-mouse'));
        }
        torpedoHud?.update({ status: game.torpedoStatus(), camera, width: canvas.clientWidth, height: canvas.clientHeight });
        if (plot?.visible) plot.update(game.plot(), dt, game.torpedoMode);
        gunHud?.update({
          status,
          camera,
          contacts: game.targets,
          sightUp: sightOwns,
          sightFovDeg: sight.fovDeg,
          hits: game.enemies.reduce((n, e) => n + e.combatant.hitsTaken, 0) + game.forts.reduce((n, f) => n + f.hitsTaken, 0),
          enemy: game.enemyReadout(),
          envelope: game.envelope,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
        });
      } else {
        freeCamera?.update(dt);
      }
      widgets.update(dt);
      input.endFrame();

      camera.update(canvas.clientWidth / Math.max(canvas.clientHeight, 1));
      // Normally one frame per refresh; the survey renders several to saturate the GPU and expose real cost.
      const repeats = survey.repeats;
      const encodeStart = performance.now();
      for (let i = 0; i < repeats; i++) sea.frame(paused ? 0 : dt / repeats, camera);
      cpuMsPerFrame = (performance.now() - encodeStart) / repeats;
      window.__frames = (window.__frames ?? 0) + 1;

      survey.onFrame(frameMs, cpuMsPerFrame);
      if (fixedScale === null && !survey.running) {
        const next = scaler.sample(frameMs, dt);
        if (next !== null) sizer.renderScale = next;
      }
    }

    fpsFrames++;
    if (now - fpsSince >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsSince);
      fpsFrames = 0;
      fpsSince = now;
      controls.refresh();
      const { adapterInfo } = gpu;
      const g = sea.gpuTimes;
      const gpuLine = g
        ? `gpu ms* sky ${g.sky.toFixed(1)}  ocean ${g.ocean.toFixed(1)}  shadow ${g.shadow.toFixed(1)}  scene ${g.scene.toFixed(1)}  post ${g.post.toFixed(1)}  = ${g.total.toFixed(1)}`
        : 'gpu ms* (no timestamp queries)';
      overlay.setStats(
        [
          `FALL OF SHOT  M7 ${narrows ? 'narrows' : attack ? 'attack' : 'duel'}${paused ? '  [PAUSED]' : ''}`,
          `${adapterInfo.vendor} ${adapterInfo.architecture}`.trim(),
          `${fps.toFixed(0)} fps   sim tick ${tick}`,
          `${sizer.width}x${sizer.height}  scale ${sizer.renderScale.toFixed(2)} (${scaler.changes} changes)  ocean ${oceanSize}  msaa ${msaa}`,
          gpuLine,
          `* GPU phase times are hints on Apple GPUs; use Perf survey for real costs.`,
          `gpu errors: ${gpu.errors.length}   input ${input.activeDevice}`,
        ].join('\n'),
      );
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="panel" style="position:fixed;left:8px;top:8px;right:8px">${String(err)}</pre>`);
});
