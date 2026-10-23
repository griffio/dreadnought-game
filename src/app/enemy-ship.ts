import type { ShipPaint } from '../render/ships/ship-renderer';
import type { SeaRenderer } from '../render/sea-renderer';
import type { ShipModel } from '../render/ships/forge/spec';
import { DuelAi, AGGRESSIVE, type AiProfile } from '../sim/combat/ai';
import { Combatant, setupExtras } from '../sim/combat/combatant';
import { DestroyerAi, TORPEDO_ATTACK, type DestroyerProfile } from '../sim/combat/destroyer-ai';
import type { ShipSetup } from '../sim/combat/setup';
import type { Environment } from '../sim/gunnery/ballistics';
import { ENEMY_SOLVE_PERIOD, enemyAiSeed } from '../sim/combat/convention';
import { Rng } from '../sim/rng';
import { rudderForCourse } from '../sim/ships/autopilot';
import { TELEGRAPH_MIN } from '../sim/ships/dynamics';
import type { SmokeField } from '../sim/smoke/smoke-field';
import type { TorpedoWorld } from '../sim/torpedo/world';
import { ShipActor } from './ship-actor';

const DEG = Math.PI / 180;

/** A course and speed to hold, for a target that does not fight back (gunnery practice). */
export interface TargetPlan {
  courseDeg: number;
  speedKn: number;
  /** Alter course by +-amplitude every `periodS` seconds (a zigzag), degrees. 0 = steady course. */
  zigzagDeg?: number;
  zigzagPeriodS?: number;
}

export interface EnemyOptions {
  id: number;
  seed: number;
  env: () => Environment;
  visibilityKm: () => number;
  /** The ship she fights (supplied after construction, since the two are made together). */
  foe: () => Combatant | null;
  /** A passive target steams its plan and never fires; otherwise the captain and gunnery officer take over. */
  plan?: TargetPlan | null;
  /** Who commands her: a gunnery duellist, or a torpedo boat captain. */
  captain?: 'duel' | 'destroyer';
  profile?: AiProfile;
  destroyerProfile?: DestroyerProfile;
  torpedoes: TorpedoWorld;
  smoke: SmokeField;
  /** Hull and upperworks colour, linear. */
  paint?: Partial<ShipPaint>;
}

/**
 * An opposing ship: a ship actor (motion, wake, picture), the combatant that is her armour and guns, and a captain to
 * fight her. In gunnery practice she can instead be a passive target holding a course.
 */
export class EnemyShip extends ShipActor {
  override readonly combatant: Combatant;
  readonly ai: DuelAi | null;
  readonly destroyerAi: DestroyerAi | null;
  readonly plan: TargetPlan | null;
  private elapsed = 0;

  constructor(sea: SeaRenderer, private readonly setup: ShipSetup, model: ShipModel, opts: EnemyOptions) {
    super(sea, model, setup.maxSpeedKn, { hull: [0.2, 0.215, 0.23], superstructure: [0.25, 0.265, 0.28], ...opts.paint }, setup.handling);
    this.plan = opts.plan ?? null;
    this.combatant = new Combatant({
      id: opts.id,
      name: setup.name,
      ship: setup.ship,
      damage: setup.damage,
      dynamics: this.dynamics,
      frame: () => this.frame,
      batteries: setup.batteries,
      rangefinder: setup.rangefinder,
      skill: setup.skill,
      env: opts.env,
      visibilityKm: opts.visibilityKm,
      seed: opts.seed,
      solvePeriod: ENEMY_SOLVE_PERIOD,
      torpedoes: opts.torpedoes,
      smoke: opts.smoke,
      ...setupExtras(setup),
    });
    this.damage = this.combatant.damage;
    const rng = new Rng(enemyAiSeed(opts.seed));
    const fights = !this.plan;
    this.ai = fights && opts.captain !== 'destroyer' ? new DuelAi(this.combatant, opts.foe, opts.profile ?? AGGRESSIVE, rng) : null;
    this.destroyerAi = fights && opts.captain === 'destroyer' ? new DestroyerAi(this.combatant, opts.foe, opts.destroyerProfile ?? TORPEDO_ATTACK, rng) : null;
  }

  /**
   * Whether she is out of the fight: beaten, sunk, or away with her torpedoes spent. A ship that will never strike her colours
   * is beaten when she is crippled: she has no guns or no way on, and nothing left to fight with.
   */
  get finished(): boolean {
    const s = this.combatant.damage.status;
    return (
      s === 'struck' ||
      s === 'sinking' ||
      s === 'sunk' ||
      s === 'exploded' ||
      (s === 'crippled' && this.setup.neverStrikes === true) ||
      this.destroyerAi?.state === 'escaped'
    );
  }

  /** Put the ship at a position and heading, already steaming at her plan's (or fighting) speed. */
  start(x: number, z: number, headingDeg: number): void {
    this.setPosition(x, z, headingDeg);
    this.elapsed = 0;
    const d = this.dynamics;
    if (this.plan) {
      // FULL AHEAD is 80% of the maximum, so give the ship the maximum that makes the plan speed exactly that.
      if (this.plan.speedKn <= 0.05) d.setTelegraph(0);
      else {
        d.handling.maxSpeedKn = this.plan.speedKn / d.handling.telegraphFraction[3 - TELEGRAPH_MIN]!;
        this.ship.referenceSpeed = d.handling.maxSpeedKn * 0.514444;
        d.setTelegraph(3);
      }
    } else {
      d.setTelegraph(3);
    }
    d.speed = d.orderedSpeed;
  }

  /** Decide: set the helm and engines for this step. Returns the triggers to hold for each battery. */
  think(dt: number, simTime: number): boolean[] {
    if (this.destroyerAi) return this.destroyerAi.update(simTime);
    if (!this.plan) return this.ai!.update(simTime);
    this.elapsed += dt;
    const p = this.plan;
    let course = p.courseDeg;
    if (p.zigzagDeg && p.zigzagPeriodS) course += (Math.floor(this.elapsed / p.zigzagPeriodS) % 2 === 0 ? 1 : -1) * p.zigzagDeg;
    this.dynamics.setRudderOrder(rudderForCourse(this.dynamics, course * DEG));
    return this.combatant.batteries.map(() => false);
  }
}
