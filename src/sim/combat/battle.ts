import type { Environment } from '../gunnery/ballistics';
import { DEFAULT_WAVE_SPEC, WaveField } from '../ocean/waves';
import { Rng } from '../rng';
import { Afloat, kickSeed } from '../ships/afloat';
import { handlingFor, ShipDynamics } from '../ships/dynamics';
import type { TorpedoEvent } from '../torpedo/world';
import { DuelAi, type AiProfile } from './ai';
import { Arena } from './arena';
import { Combatant, setupExtras, type ShipReport } from './combatant';
import {
  CHECKPOINT_TICKS,
  DEFAULT_VISIBILITY_KM,
  DIRECTOR_DEFAULT,
  ENEMY_SOLVE_PERIOD,
  enemyAiSeed,
  enemySeed,
  fightEnvironment,
  fightFingerprint,
  FIRST_ENEMY_ID,
  PLAYER_ID,
  PLAYER_TORPEDO_SPREAD,
  playerAiSeed,
  SHELL_WIND_FACTOR,
} from './convention';
import { DestroyerAi, TORPEDO_ATTACK, type DestroyerProfile } from './destroyer-ai';
import { PlayerBot, type Evasion } from './player-bot';
import type { ShipSetup } from './setup';

const DEG = Math.PI / 180;
const BEATEN = new Set(['struck', 'sinking', 'sunk', 'exploded']);

export type Brain = { kind: 'player-bot'; evasion: Evasion } | { kind: 'duel'; profile: AiProfile } | { kind: 'destroyer'; profile?: DestroyerProfile };

export interface BattleShip {
  setup: ShipSetup;
  side: 'player' | 'enemy';
  x: number;
  z: number;
  headingDeg: number;
  brain: Brain;
  /** Speed at the start, knots (default: she begins at the speed of FULL AHEAD). */
  startKnots?: number;
  /** The telegraph at the start (default FULL AHEAD, 3; the game's player begins at STOP, 0). */
  startTelegraph?: number;
}

export interface BattleOptions {
  seed: number;
  ships: BattleShip[];
  /** The air the shells fly in (default: the game's default sea's wind, as the game has it). */
  env?: Environment;
  /** How far the lookouts see, km (default: the game's default day). */
  visibilityKm?: number;
  /** The waves the ships float on (default: the game's own sea; `WaveField.flat()` for the old flat water). */
  waves?: WaveField;
}

export type BattleOutcome = 'player-won' | 'player-lost' | 'draw' | 'running';

interface Member {
  combatant: Combatant;
  afloat: Afloat;
  brain: { update(now: number): boolean[] };
  side: 'player' | 'enemy';
  destroyer: DestroyerAi | null;
}

/**
 * A fight between any number of ships, headless: the game's own sea under them and its wind over them, the full damage, gunnery and
 * torpedo models, an AI on every ship but the player's, which is a bot. It is how the destroyer attack is measured and tuned, and runs
 * the same simulation the game steps with its own ships, with the game's ids and seeds, so that a seed gives the game's fight.
 */
export class Battle {
  readonly arena: Arena;
  readonly members: Member[] = [];
  time = 0;
  readonly log: ShipReport[] = [];
  readonly torpedoEvents: TorpedoEvent[] = [];
  /** A fingerprint of the fight at every CHECKPOINT_TICKS steps, by step number: what the game keeps, to be compared with it. */
  readonly checkpoints = new Map<number, string>();
  private tick = 0;

  constructor(opts: BattleOptions) {
    const env = opts.env ?? fightEnvironment(DEFAULT_WAVE_SPEC);
    this.arena = new Arena(opts.seed);
    this.arena.smoke.wind = [env.windX / SHELL_WIND_FACTOR, env.windZ / SHELL_WIND_FACTOR];
    const waves = opts.waves ?? WaveField.fromSpec();
    const kickRng = new Rng(kickSeed(opts.seed));
    let enemies = 0;
    for (const s of opts.ships) {
      const hull = s.setup.ship.hull;
      const player = s.side === 'player';
      // The game's ids and seeds: the player is 1 with the fight's seed, the enemies 2, 3... with theirs.
      const k = enemies;
      if (!player) enemies++;
      const id = player ? PLAYER_ID : FIRST_ENEMY_ID + k;
      const seed = player ? opts.seed : enemySeed(opts.seed, k);
      const dynamics = new ShipDynamics(handlingFor(hull.length, s.setup.maxSpeedKn, s.setup.handling));
      dynamics.x = s.x;
      dynamics.z = s.z;
      dynamics.heading = s.headingDeg * DEG;
      dynamics.setTelegraph(s.startTelegraph ?? 3);
      dynamics.speed = s.startKnots !== undefined ? s.startKnots * 0.514444 : dynamics.orderedSpeed;
      const afloat = new Afloat(hull.length, hull.beam, waves);
      const frame = () => afloat.frame(dynamics);
      const c = new Combatant({
        id,
        name: s.setup.name,
        ship: s.setup.ship,
        damage: s.setup.damage,
        dynamics,
        frame,
        batteries: s.setup.batteries,
        rangefinder: s.setup.rangefinder,
        skill: s.setup.skill,
        env: () => env,
        visibilityKm: () => opts.visibilityKm ?? DEFAULT_VISIBILITY_KM,
        seed,
        solvePeriod: player ? undefined : ENEMY_SOLVE_PERIOD,
        torpedoes: this.arena.torpedoes,
        smoke: this.arena.smoke,
        ...setupExtras(s.setup),
        ...(player && !s.setup.director ? { directorHeight: DIRECTOR_DEFAULT[1] } : {}),
      });
      if (player) {
        c.damage.canStrike = false;
        c.torpedoSpread = PLAYER_TORPEDO_SPREAD;
      }
      c.onHitMark = (mark) => afloat.hitKick(kickRng, mark);
      this.arena.add(c);
      this.members.push({ combatant: c, afloat, brain: { update: () => [] }, side: s.side, destroyer: null });
    }
    for (const m of this.members) {
      const others = this.members.filter((o) => o.side !== m.side).map((o) => o.combatant);
      m.combatant.setOpponents(others);
    }
    // Brains need the whole cast to exist.
    opts.ships.forEach((s, i) => {
      const m = this.members[i]!;
      const hostiles = () => this.members.filter((o) => o.side !== m.side).map((o) => o.combatant);
      const foe = () => {
        const alive = hostiles().filter((c) => c.alive && c.damage.status !== 'struck');
        alive.sort((a, b) => Math.hypot(a.x - m.combatant.x, a.z - m.combatant.z) - Math.hypot(b.x - m.combatant.x, b.z - m.combatant.z));
        return alive[0] ?? null;
      };
      const b = s.brain;
      // Each captain's seed from his ship's, as the game draws them.
      const aiSeed = m.side === 'player' ? playerAiSeed(opts.seed) : enemyAiSeed(enemySeed(opts.seed, m.combatant.id - FIRST_ENEMY_ID));
      if (b.kind === 'player-bot') m.brain = new PlayerBot(m.combatant, hostiles, this.arena.torpedoes, b.evasion);
      else if (b.kind === 'duel') m.brain = new DuelAi(m.combatant, foe, b.profile, new Rng(aiSeed));
      else {
        const ai = new DestroyerAi(m.combatant, () => this.playerShip() ?? foe(), b.profile ?? TORPEDO_ATTACK, new Rng(aiSeed));
        m.brain = ai;
        m.destroyer = ai;
      }
    });
  }

  playerShip(): Combatant | null {
    return this.members.find((m) => m.side === 'player')?.combatant ?? null;
  }

  get player(): Combatant {
    return this.playerShip()!;
  }

  get enemies(): Combatant[] {
    return this.members.filter((m) => m.side === 'enemy').map((m) => m.combatant);
  }

  get outcome(): BattleOutcome {
    const p = this.player.damage.status;
    if (p === 'sinking' || p === 'sunk' || p === 'exploded') return 'player-lost';
    const beaten = this.members
      .filter((m) => m.side === 'enemy')
      .every((m) => BEATEN.has(m.combatant.damage.status) || m.destroyer?.state === 'escaped');
    // Torpedoes already in the water are still to be reckoned with.
    if (beaten && this.arena.torpedoes.torpedoes.length === 0) return 'player-won';
    return 'running';
  }

  step(): void {
    const dt = 1 / 60;
    this.time += dt;
    const triggers = this.members.map((m) => m.brain.update(this.time));
    for (const m of this.members) m.combatant.dynamics.step(dt);
    this.members.forEach((m, i) => m.combatant.step(dt, this.time, triggers[i]!));
    // Every ship floats on this moment's waves, with the shove of what she has just fired: after the guns, as in the game.
    for (const m of this.members) m.afloat.step(dt, this.time, m.combatant.dynamics, m.combatant.damage, m.combatant.batteries.map((u) => u.gunnery.battery));
    this.torpedoEvents.push(...this.arena.step(dt));
    for (const m of this.members) this.log.push(...m.combatant.drainReports());
    this.tick++;
    if (this.tick % CHECKPOINT_TICKS === 0) this.checkpoints.set(this.tick, fightFingerprint(this.player, this.enemies, this.arena.torpedoes.torpedoes.length));
  }

  run(maxSeconds: number): BattleOutcome {
    while (this.time < maxSeconds && this.outcome === 'running') this.step();
    return this.outcome === 'running' ? 'draw' : this.outcome;
  }
}
