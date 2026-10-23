/** Fixed-timestep accumulator. The sim advances in whole steps; the renderer interpolates with `alpha`. */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly stepSeconds: number,
    private readonly maxStepsPerFrame = 5,
    private readonly maxFrameSeconds = 0.25,
  ) {}

  /** Feed the real frame time; returns how many sim steps to run this frame. */
  advance(frameSeconds: number): number {
    // A NaN frame would poison the accumulator for good (no step would ever run again).
    if (!Number.isFinite(frameSeconds)) frameSeconds = 0;
    this.acc += Math.min(Math.max(frameSeconds, 0), this.maxFrameSeconds);
    let steps = 0;
    while (steps < this.maxStepsPerFrame && this.acc + 1e-9 >= this.stepSeconds) {
      this.acc -= this.stepSeconds;
      steps++;
    }
    // Spiral-of-death guard: if we hit the step cap, drop whole steps of backlog.
    if (steps === this.maxStepsPerFrame && this.acc >= this.stepSeconds) {
      this.acc %= this.stepSeconds;
    }
    if (this.acc < 0) this.acc = 0;
    return steps;
  }

  /** Fraction of the next step already elapsed, in [0, 1). */
  get alpha(): number {
    return this.acc / this.stepSeconds;
  }
}
