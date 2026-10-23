import { CALM, type Environment } from '../gunnery/ballistics';
import { fortShipSpec } from '../../data/forts/fort-model';
import { Fort, type FortSpec } from '../fort/fort';
import { mountsFromSpec } from '../gunnery/mounts';
import { SpotterPlane } from '../air/spotter';
import { MineField } from '../mines/mines';
import { WaveField } from '../ocean/waves';
import { Rng } from '../rng';
import { Afloat, kickSeed } from '../ships/afloat';
import { handlingFor, ShipDynamics } from '../ships/dynamics';
import { Grounding } from '../ships/grounding';
import type { Terrain } from '../terrain/terrain';
import type { ShellEvent } from '../gunnery/shell-world';
import { Combatant, setupExtras, type ShipReport } from './combatant';
import type { ShellKind } from '../gunnery/shells';
import { pacedSetup, REAL, type Pace } from '../pace';
import type { ShipSetup } from './setup';

const DEG = Math.PI / 180;

export interface SiegeOptions {
  seed: number;
  terrain: Terrain;
  setup: ShipSetup;
  start: { x: number; z: number; headingDeg: number };
  forts: readonly FortSpec[];
  mines?: MineField;
  env?: Environment;
  visibilityKm?: number;
  /** How fast the world runs: the ship, the forts and the aircraft at that pace (default: the real one). */
  pace?: Pace;
  /** The round her main guns are loaded with (default: armour-piercing). */
  shell?: ShellKind;
  /** The waves she floats on (default: the game's own sea; `WaveField.flat()` for the old flat water). */
  waves?: WaveField;
}

/**
 * A ship against the shore: the Dreadnought, the land, the forts, the mines and the spotter aircraft, with no renderer. It is how
 * the Narrows is measured and tuned, and runs the same simulation the game does.
 */
export class Siege {
  readonly terrain: Terrain;
  readonly forts: Fort[] = [];
  readonly mines: MineField;
  readonly player: Combatant;
  readonly plane: SpotterPlane;
  readonly grounding: Grounding;
  /** Her hull on the waves. */
  readonly afloat: Afloat;
  readonly log: ShipReport[] = [];
  private readonly kickRng: Rng;
  time = 0;
  groundings = 0;
  mineHits = 0;
  private readonly dynamics: ShipDynamics;

  constructor(opts: SiegeOptions) {
    const env = opts.env ?? CALM;
    const setup = pacedSetup(opts.setup, opts.pace ?? REAL);
    this.terrain = opts.terrain;
    this.mines = opts.mines ?? new MineField();
    const hull = setup.ship.hull;
    this.dynamics = new ShipDynamics(handlingFor(hull.length, setup.maxSpeedKn, setup.handling));
    const d = this.dynamics;
    d.x = opts.start.x;
    d.z = opts.start.z;
    d.heading = opts.start.headingDeg * DEG;
    d.setTelegraph(2);
    d.speed = d.orderedSpeed;
    this.afloat = new Afloat(hull.length, hull.beam, opts.waves ?? WaveField.fromSpec());
    this.kickRng = new Rng(kickSeed(opts.seed));
    const frame = () => this.afloat.frame(d);
    this.player = new Combatant({
      id: 1,
      name: setup.name,
      ship: setup.ship,
      damage: setup.damage,
      dynamics: d,
      frame,
      batteries: setup.batteries,
      rangefinder: setup.rangefinder,
      skill: setup.skill,
      env: () => env,
      visibilityKm: () => opts.visibilityKm ?? 40,
      seed: opts.seed * 31 + 1,
      solvePeriod: 0.5,
      terrain: opts.terrain,
      ...setupExtras(setup),
    });
    this.player.damage.canStrike = false;
    this.player.onHitMark = (mark) => this.afloat.hitKick(this.kickRng, mark);
    if (opts.shell) this.player.setShell(opts.shell);
    this.grounding = new Grounding(opts.terrain, { length: hull.length, beam: hull.beam, draft: hull.draft });

    opts.forts.forEach((spec, i) => {
      const fort = new Fort({ spec, mounts: mountsFromSpec(fortShipSpec(spec)), terrain: opts.terrain, env: () => env, visibilityKm: () => opts.visibilityKm ?? 40, seed: opts.seed * 17 + i, id: 100 + i, pace: opts.pace });
      fort.setOpponents([this.player]);
      this.forts.push(fort);
    });
    this.player.setOpponents(this.forts);
    this.plane = new SpotterPlane({ ship: () => ({ x: d.x, z: d.z }) }, opts.terrain, (x, z, r) => this.mines.reveal(x, z, r), () => opts.visibilityKm ?? 40, opts.pace);
    this.player.setAerial(this.plane);
    for (const fort of this.forts) {
      fort.onReport = () => {};
    }
  }

  get dyn(): ShipDynamics {
    return this.dynamics;
  }

  /** The forts the lookouts know of: not hidden, or lately given away by their own flash. */
  knownForts(): Fort[] {
    return this.forts.filter((f) => f.revealed(this.time));
  }

  step(triggers: readonly boolean[]): void {
    const dt = 1 / 60;
    this.time += dt;
    this.plane.update(dt);
    this.grounding.begin(this.dynamics);
    this.dynamics.step(dt);
    const g = this.grounding.resolve(this.dynamics, this.player.cfg.ship.hull.draft + this.player.damage.sinkage * 0);
    if (g.impactSpeed > 1) {
      this.groundings++;
      this.player.damage.applyGrounding(g.at, g.impactSpeed);
    }
    const events: ShellEvent[] = this.player.step(dt, this.time, triggers);
    // She floats on this moment's waves, with the shove of what she has just fired: after the guns, as in the game.
    this.afloat.step(dt, this.time, this.dynamics, this.player.damage, this.player.batteries.map((u) => u.gunnery.battery));
    for (const f of this.forts) {
      const own = f.step(dt, this.time);
      for (const e of own) f.receive(e);
    }
    // Where the ship's shells fall near a fort shakes the crews.
    for (const e of events) for (const f of this.forts) f.receive(e);
    for (const hit of this.mines.step([this.player.torpedoTarget])) {
      void hit;
      this.mineHits++;
    }
    this.log.push(...this.player.drainReports());
  }

  get silenced(): boolean {
    return this.forts.every((f) => f.silenced);
  }

  get lost(): boolean {
    const s = this.player.damage.status;
    return s === 'sinking' || s === 'sunk' || s === 'exploded';
  }
}
