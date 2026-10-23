import { CALM, type Environment } from '../gunnery/ballistics';
import type { ShellKind } from '../gunnery/shells';
import { WaveField } from '../ocean/waves';
import { Rng } from '../rng';
import { Afloat, kickSeed } from '../ships/afloat';
import { handlingFor, ShipDynamics } from '../ships/dynamics';
import { DuelAi, type AiProfile } from './ai';
import { Combatant, type ShipReport } from './combatant';
import type { ShipSetup } from './setup';

export interface DuelSide {
  setup: ShipSetup;
  ai: AiProfile;
  /** Start position (m), heading (degrees compass). */
  x: number;
  z: number;
  headingDeg: number;
  /** The round her main guns are loaded with (default: armour-piercing). */
  shell?: ShellKind;
}

export interface DuelOptions {
  seed: number;
  a: DuelSide;
  b: DuelSide;
  env?: Environment;
  visibilityKm?: number;
  /** The waves the ships float on (default: the game's own sea; `WaveField.flat()` for the old flat water). */
  waves?: WaveField;
}

export type DuelOutcome = 'a-won' | 'b-won' | 'draw' | 'running';

const DEG = Math.PI / 180;
const END_STATES = new Set(['struck', 'sinking', 'sunk', 'exploded']);

/**
 * A fight between two ships with no renderer: the game's own sea under them, the full damage and gunnery models, and an AI on each side. It
 * exists to measure and tune the duel (how long it lasts, who wins, how often a magazine goes up) and is the same
 * simulation the game steps with its own ships.
 */
export class Duel {
  readonly a: Combatant;
  readonly b: Combatant;
  readonly aiA: DuelAi;
  readonly aiB: DuelAi;
  time = 0;
  readonly log: ShipReport[] = [];
  /** Each ship's hull on the waves, in the order a, b. */
  readonly afloat: Afloat[] = [];
  private readonly step60 = 1 / 60;
  private readonly kickRng: Rng;

  constructor(opts: DuelOptions) {
    const env = opts.env ?? CALM;
    const waves = opts.waves ?? WaveField.fromSpec();
    this.kickRng = new Rng(kickSeed(opts.seed));
    const make = (id: number, side: DuelSide, seed: number): Combatant => {
      const hull = side.setup.ship.hull;
      const dynamics = new ShipDynamics(handlingFor(hull.length, side.setup.maxSpeedKn, side.setup.handling));
      dynamics.x = side.x;
      dynamics.z = side.z;
      dynamics.heading = side.headingDeg * DEG;
      dynamics.setTelegraph(3);
      dynamics.speed = dynamics.orderedSpeed;
      const afloat = new Afloat(hull.length, hull.beam, waves);
      this.afloat.push(afloat);
      const frame = () => afloat.frame(dynamics);
      const c = new Combatant({
        id,
        name: side.setup.name,
        ship: side.setup.ship,
        damage: side.setup.damage,
        dynamics,
        frame,
        batteries: side.setup.batteries,
        rangefinder: side.setup.rangefinder,
        skill: side.setup.skill,
        env: () => env,
        visibilityKm: () => opts.visibilityKm ?? 40,
        seed,
        solvePeriod: 0.5,
        directorHeight: side.setup.director?.[1],
        jams: side.setup.jams,
        wounds: side.setup.wounds,
        rudderJam: side.setup.rudderJam,
        neverStrikes: side.setup.neverStrikes,
        plot: side.setup.plot,
      });
      if (side.shell) c.setShell(side.shell);
      c.onHitMark = (mark) => afloat.hitKick(this.kickRng, mark);
      return c;
    };
    const rng = new Rng(opts.seed);
    this.a = make(1, opts.a, opts.seed * 7 + 1);
    this.b = make(2, opts.b, opts.seed * 13 + 5);
    this.a.setOpponents([this.b]);
    this.b.setOpponents([this.a]);
    this.aiA = new DuelAi(this.a, () => this.b, opts.a.ai, new Rng(rng.next() * 1e9));
    this.aiB = new DuelAi(this.b, () => this.a, opts.b.ai, new Rng(rng.next() * 1e9));
  }

  get outcome(): DuelOutcome {
    const aEnd = END_STATES.has(this.a.damage.status);
    const bEnd = END_STATES.has(this.b.damage.status);
    if (aEnd && bEnd) return 'draw';
    if (bEnd) return 'a-won';
    if (aEnd) return 'b-won';
    return 'running';
  }

  /** Advance one 1/60 s step. */
  step(): void {
    const dt = this.step60;
    this.time += dt;
    const ta = this.aiA.update(this.time);
    const tb = this.aiB.update(this.time);
    this.a.dynamics.step(dt);
    this.b.dynamics.step(dt);
    this.a.step(dt, this.time, ta);
    this.b.step(dt, this.time, tb);
    // Both float on this moment's waves, with the shove of what they have just fired: after the guns, as in the game.
    this.afloat[0]!.step(dt, this.time, this.a.dynamics, this.a.damage, this.a.batteries.map((u) => u.gunnery.battery));
    this.afloat[1]!.step(dt, this.time, this.b.dynamics, this.b.damage, this.b.batteries.map((u) => u.gunnery.battery));
    this.log.push(...this.a.drainReports(), ...this.b.drainReports());
  }

  /** Run until one side is beaten or `maxSeconds` pass. */
  run(maxSeconds: number): DuelOutcome {
    while (this.time < maxSeconds && this.outcome === 'running') this.step();
    return this.outcome === 'running' ? 'draw' : this.outcome;
  }
}
