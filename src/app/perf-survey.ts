import type { SeaDebugFlags, SeaRenderer } from '../render/sea-renderer';

export interface SurveyRow {
  name: string;
  scale: number;
  pixels: number;
  /** Frames rendered per display refresh during this step (stress multiplier). */
  repeats: number;
  /** Display refreshes per second actually achieved. */
  fps: number;
  /** Milliseconds per display refresh. */
  intervalMs: number;
  /** Estimated cost of one frame: interval / repeats. Valid only when the step saturated the GPU. */
  costMs: number;
  /** costMs minus the baseline row's cost: what turning this feature off saved (negative) or added. */
  deltaMs: number;
  /** JavaScript time to encode and submit one frame, ms. */
  cpuMs: number;
  /** True when the step ran at the display rate, so costMs is only an upper bound. */
  clipped: boolean;
  /** Sum of per-phase GPU timestamps; on tile-based GPUs these overlap, so treat as a relative hint only. */
  timestampSumMs: number | null;
}

interface Step {
  name: string;
  scale: number;
  flags: Partial<SeaDebugFlags>;
  /** Start a battle (muzzle smoke, splashes, bursts) before measuring, so the effects have something to draw. */
  battle?: boolean;
  /** Lay a destroyer's smoke screen across the view before measuring. */
  screen?: boolean;
  /** Part of the shorter survey of the ship alone (`survey=ship`). */
  ship?: boolean;
  /** Part of the short A/B of the sea's grid culling (`survey=sea`): two baselines round the whole circle, done while the device is cool. */
  sea?: boolean;
  /** A scene put on for the step and taken off after it: the ship hurt, the ship broken in two, the wreckage of one that has gone down. */
  scene?: Scene;
}

/** Something to put on screen for one step: `on` sets it up, `off` puts everything back as it was. */
export type Scene = 'hurt' | 'broken' | 'wreckage' | 'cutaway';
export type Scenes = Partial<Record<Scene, { on(): void; off(): void }>>;

const STEPS: Step[] = [
  { name: 'baseline', scale: 1, flags: {}, ship: true, sea: true },
  // The sea's grid is normally drawn only in the arc the camera sees (about two fifths of it): the whole circle, for the saving. Early,
  // while the device is still cool: late rows wander by milliseconds as a tablet throttles.
  { name: 'sea grid: whole circle drawn', scale: 1, flags: { oceanWholeCircle: true }, sea: true },
  // The ship drawn by the pipeline that can discard pixels, as only a ship under the sight's cutaway or broken in two now is: on a
  // tile-based GPU that costs the hidden-surface removal, and the ship is double-sided.
  { name: 'ship drawn with the discarding shader', scale: 1, flags: { shipDiscard: true }, ship: true },
  // The ship's finish, taken off a layer at a time (see the ladder in ship.wgsl): each row is the one before less something, so what a row
  // saves is the cost of that layer. The damage looks and lettering first, then the weathering pictures, the noise and plating, the
  // shadow lookups, and last the reflections and haze, which leaves flat lit colour.
  { name: 'ship finish: no damage looks or lettering', scale: 1, flags: { shipDetail: 1 }, ship: true },
  { name: 'ship finish: and no weathering pictures', scale: 1, flags: { shipDetail: 2 }, ship: true },
  { name: 'ship finish: and no noise or plating', scale: 1, flags: { shipDetail: 3 }, ship: true },
  { name: 'ship finish: and no shadow lookups', scale: 1, flags: { shipDetail: 4 }, ship: true },
  { name: 'ship finish: and no reflections or haze', scale: 1, flags: { shipDetail: 5 }, ship: true },
  { name: 'baseline (after the ship ladder)', scale: 1, flags: {}, ship: true },
  // What the damage looks cost: a ship with fires lighting her hull, two turrets wrecked and charred, and painted in dazzle; a ship broken
  // in two (a second ship drawn, each cut by the shader); and the wreckage and oil that a ship leaves on the water.
  { name: 'ship hurt: fires, wrecks, dazzle', scale: 1, flags: {}, scene: 'hurt', ship: true },
  { name: 'ship broken in two', scale: 1, flags: {}, scene: 'broken', ship: true },
  // The same, drawn in part, to see where its cost is: the hull and decks only (cut at the vertices), and the works only (cut by discarding).
  { name: 'ship broken in two: hull and decks only', scale: 1, flags: { shipParts: 1 }, scene: 'broken', ship: true },
  { name: 'ship broken in two: works only', scale: 1, flags: { shipParts: 2 }, scene: 'broken', ship: true },
  { name: 'wreckage and oil slick', scale: 1, flags: {}, scene: 'wreckage', ship: true },
  // The ship's works drawn by the pipeline that can discard, as they are in the director's sight (the lens is not moved: what is measured is the
  // pipeline's cost, not the view).
  { name: 'ship under the sight cutaway', scale: 1, flags: {}, scene: 'cutaway', ship: true },
  // The same as the baseline, to bracket the rows above: a device that is still warming up reads the first baseline high, so each is
  // better compared with the mean of the two plain rows either side of it than with the first alone.
  { name: 'baseline (after the ship scenes)', scale: 1, flags: {}, ship: true },
  { name: 'battle effects drawn', scale: 1, flags: {}, battle: true },
  { name: 'battle effects hidden', scale: 1, flags: { skipFx: true }, battle: true },
  { name: 'smoke screen drawn', scale: 1, flags: {}, screen: true },
  { name: 'smoke screen hidden', scale: 1, flags: { skipFx: true }, screen: true },
  // In the Narrows: what the land and its surf cost. The pair is back to back so that the iPad's warming up cancels; away from the
  // Narrows there is no land and the two rows are the same, which tells how large the noise is.
  { name: 'land hidden (terrain and surf)', scale: 1, flags: { skipTerrain: true } },
  { name: 'land drawn (again)', scale: 1, flags: {} },
  { name: 'resolution 75%', scale: 0.75, flags: {} },
  { name: 'resolution 50%', scale: 0.5, flags: {} },
  { name: 'no sun shadow', scale: 1, flags: { skipShadow: true }, ship: true },
  { name: 'no ship (and no shadow)', scale: 1, flags: { skipShips: true }, ship: true },
  { name: 'no bloom', scale: 1, flags: { skipBloom: true } },
  { name: 'no cloud/ambient refresh', scale: 1, flags: { skipClouds: true } },
  { name: 'ocean field frozen (no FFT)', scale: 1, flags: { freezeOcean: true } },
  { name: 'no ocean surface drawn', scale: 1, flags: { skipOceanDraw: true } },
  { name: 'no sky drawn', scale: 1, flags: { skipSkyDraw: true } },
  {
    name: 'floor: sky + composite only',
    scale: 1,
    flags: { skipOceanDraw: true, skipShips: true, freezeOcean: true, skipBloom: true, skipClouds: true },
  },
  { name: 'baseline (repeat, thermal check)', scale: 1, flags: {}, sea: true },
];

const WARMUP_MS = 2200;
const MEASURE_MS = 3200;
/**
 * If a single frame already takes longer than this per refresh, the GPU is saturated without stress. A ProMotion iPad lets
 * its refresh fall to about 48 Hz (20.8 ms) when the content is light, so an interval near 20 ms says nothing about cost:
 * it was read as saturation in the first smoke-screen survey, and every row at that cadence came out the same.
 */
const SATURATED_MS = 26;
const STRESS_REPEATS = 6;
const MAX_REPEATS = 24;
/** A re-measure with more repeats only needs a short warm-up: the configuration has not changed. */
const REMEASURE_WARMUP_MS = 900;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Measures what each feature costs on the device it runs on.
 *
 * A vsync-locked display hides cost: every configuration reads 60 fps until it fails. So the survey renders
 * each frame several times per refresh (`repeats`) until the GPU is saturated; then interval / repeats is the
 * true per-frame cost, with sub-millisecond resolution. The frame loop must call `onFrame` every refresh and
 * render `repeats` times.
 */
export class PerfSurvey {
  running = false;
  /** Frames the main loop should render per display refresh right now. */
  repeats = 1;
  private frames = 0;
  private intervalSum = 0;
  private cpuSum = 0;

  constructor(
    private readonly sea: SeaRenderer,
    private readonly setScale: (scale: number) => void,
    private readonly pixelCount: () => number,
    private readonly startBattle: () => void = () => {},
    private readonly startScreen: () => void = () => {},
    private readonly scenes: Scenes = {},
  ) {}

  onFrame(intervalMs: number, cpuMsPerFrame: number): void {
    this.frames++;
    this.intervalSum += intervalMs;
    this.cpuSum += cpuMsPerFrame;
  }

  private async measure(warmupMs = WARMUP_MS): Promise<{ fps: number; intervalMs: number; cpuMs: number }> {
    await wait(warmupMs);
    this.frames = 0;
    this.intervalSum = 0;
    this.cpuSum = 0;
    const t0 = performance.now();
    await wait(MEASURE_MS);
    const seconds = (performance.now() - t0) / 1000;
    const n = Math.max(this.frames, 1);
    return { fps: this.frames / seconds, intervalMs: this.intervalSum / n, cpuMs: this.cpuSum / n };
  }

  /** `only` 'ship' is the short survey of the ship alone (about a minute and a half), 'sea' the half-minute A/B of the sea's culling; anything else is every step. */
  async run(log: (line: string) => void, only: 'all' | 'ship' | 'sea' = 'all'): Promise<SurveyRow[]> {
    this.running = true;
    const flags = this.sea.debug;
    const defaults = { ...flags };
    const rows: SurveyRow[] = [];
    try {
      // Calibrate: is one frame per refresh already enough to saturate the GPU?
      Object.assign(flags, defaults);
      this.setScale(1);
      this.repeats = 1;
      const probe = await this.measure();
      const repeats = probe.intervalMs > SATURATED_MS ? 1 : STRESS_REPEATS;
      log(`calibration: ${probe.fps.toFixed(1)} fps at 1 frame per refresh -> stress x${repeats}`);

      for (const step of STEPS.filter((x) => only === 'all' || (only === 'ship' ? x.ship : x.sea))) {
        Object.assign(flags, defaults, step.flags);
        this.setScale(step.scale);
        this.repeats = repeats;
        const scene = step.scene ? this.scenes[step.scene] : undefined;
        const prime = () => {
          if (step.battle) this.startBattle();
          if (step.screen) this.startScreen();
        };
        scene?.on();
        let m: { fps: number; intervalMs: number; cpuMs: number };
        let used = repeats;
        try {
          prime();
          m = await this.measure();
          // A step that still finishes within a display refresh has hidden its cost; render more frames per refresh
          // until the GPU is saturated (or we hit the cap) so every row is a real number.
          while (m.intervalMs < SATURATED_MS && used < MAX_REPEATS) {
            used = Math.min(used * 2, MAX_REPEATS);
            this.repeats = used;
            prime();
            m = await this.measure(REMEASURE_WARMUP_MS);
          }
        } finally {
          scene?.off();
        }
        const costMs = m.intervalMs / used;
        const baseline = rows[0]?.costMs ?? costMs;
        const row: SurveyRow = {
          name: step.name,
          scale: step.scale,
          pixels: this.pixelCount(),
          repeats: used,
          fps: m.fps,
          intervalMs: m.intervalMs,
          costMs,
          deltaMs: costMs - baseline,
          cpuMs: m.cpuMs,
          clipped: m.intervalMs < SATURATED_MS,
          timestampSumMs: this.sea.gpuTimes?.total ?? null,
        };
        rows.push(row);
        log(
          `${row.name.padEnd(34)} cost ${row.costMs.toFixed(1).padStart(5)} ms${row.clipped ? '*' : ' '} ` +
            `(${row.deltaMs >= 0 ? '+' : ''}${row.deltaMs.toFixed(1).padStart(5)})  x${used}  cpu ${row.cpuMs.toFixed(1)} ms  ` +
            `${(row.pixels / 1e6).toFixed(2)} MP`,
        );
      }
      log('* = could not saturate the GPU even at the repeat cap, so the cost is only an upper bound');
    } finally {
      Object.assign(flags, defaults);
      this.repeats = 1;
      this.running = false;
    }
    return rows;
  }
}
