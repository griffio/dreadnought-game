import type { HitMark } from '../../render/ships/decals';
import { HullPlaneFit, type WaveModes } from '../ocean/waves';
import type { Rng } from '../rng';
import { BATTLESHIP_FLOATING, FloatingBody } from './buoyancy';
import type { ShipDynamics } from './dynamics';
import type { ShipFrame } from './frame';

/** What the body needs to know of her hurt: list and trim from the water aboard, how far she has settled, and whether she is whole. */
interface HurtLike {
  list: number;
  trim: number;
  sinkage: number;
  status: string;
}

interface BatteryLike {
  drainKick(): { roll: number; pitch: number };
}

/**
 * A hull on the waves, stepped on the fixed simulation clock: the water under her is fitted with a plane at the moment of the step,
 * her heave, pitch and roll follow it through damped springs, and the shove of her own broadsides and of hits goes into them. The
 * frame it gives is the platform the guns are laid from, so it must be the same in the game and in a fight measured without one.
 */
/** The water under the hull is fitted every this many steps: her springs (periods of 6 to 11 s) cannot follow anything finer. */
const REFIT_EVERY = 4;

export class Afloat {
  readonly body: FloatingBody;
  private readonly fit: HullPlaneFit;
  private plane: { height: number; slopeX: number; slopeZ: number } | null = null;
  private ticks = 0;

  constructor(
    readonly length: number,
    readonly beam: number,
    private readonly waves: WaveModes,
  ) {
    this.body = new FloatingBody(BATTLESHIP_FLOATING(length, beam));
    this.fit = new HullPlaneFit(length, beam);
  }

  /** One fixed step: after her guns have been stepped (their recoil is drained here). */
  step(dt: number, t: number, d: ShipDynamics, hurt: HurtLike | null, batteries: Iterable<BatteryLike>): void {
    for (const b of batteries) {
      const kick = b.drainKick();
      if (kick.roll !== 0 || kick.pitch !== 0) this.body.kick(kick.roll, kick.pitch);
    }
    if (this.plane === null || this.ticks % REFIT_EVERY === 0) this.plane = this.fit.planeAt(this.waves, d.x, d.z, (d.heading * 180) / Math.PI, t);
    this.ticks++;
    const plane = this.plane;
    // A ship blown in two does not capsize as a whole: she floats on the waves, and the halves go down by themselves.
    const whole = hurt === null || hurt.status !== 'exploded';
    this.body.update(dt, plane, d.turnHeel + (whole ? hurt?.list ?? 0 : 0), whole ? hurt?.trim ?? 0 : 0, whole ? hurt?.sinkage ?? 0 : 0);
  }

  /** The ship as the gunnery simulation sees her: where she is, how she lies, how she moves. */
  frame(d: ShipDynamics): ShipFrame {
    return {
      x: d.x,
      y: this.body.heave,
      z: d.z,
      heading: d.heading,
      pitch: this.body.pitch,
      roll: this.body.roll,
      vx: Math.sin(d.heading) * d.speed,
      vz: -Math.cos(d.heading) * d.speed,
    };
  }

  /** A shell that bursts in her is felt through the hull: a shove that rolls and pitches her, in proportion to its weight. */
  hitKick(rng: Rng, mark: Pick<HitMark, 'kind' | 'caliberM'>): void {
    if (mark.kind !== 'burst' && mark.kind !== 'shatter') return;
    const weight = Math.min(mark.caliberM / 0.38, 1.3) * (mark.kind === 'burst' ? 1 : 0.4);
    this.body.kick((rng.next() < 0.5 ? -1 : 1) * 0.012 * weight, (rng.next() - 0.5) * 0.008 * weight);
  }
}

/** The seed of the fight's hit-kick draws, from its own seed: the same in the game and the harnesses. */
export function kickSeed(seed: number): number {
  return seed ^ 0x3a9f;
}
