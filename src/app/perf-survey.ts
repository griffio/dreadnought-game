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
}

const STEPS: Step[] = [
  { name: 'baseline', scale: 1, flags: {} },
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
  { name: 'no sun shadow', scale: 1, flags: { skipShadow: true } },
  { name: 'no ship (and no shadow)', scale: 1, flags: { skipShips: true } },
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
  { name: 'baseline (repeat, thermal check)', scale: 1, flags: {} },
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

  async run(log: (line: string) => void): Promise<SurveyRow[]> {
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

      for (const step of STEPS) {
        Object.assign(flags, defaults, step.flags);
        this.setScale(step.scale);
        this.repeats = repeats;
        const prime = () => {
          if (step.battle) this.startBattle();
          if (step.screen) this.startScreen();
        };
        prime();
        let m = await this.measure();
        let used = repeats;
        // A step that still finishes within a display refresh has hidden its cost; render more frames per refresh
        // until the GPU is saturated (or we hit the cap) so every row is a real number.
        while (m.intervalMs < SATURATED_MS && used < MAX_REPEATS) {
          used = Math.min(used * 2, MAX_REPEATS);
          this.repeats = used;
          prime();
          m = await this.measure(REMEASURE_WARMUP_MS);
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
