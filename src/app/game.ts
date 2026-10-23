import type { SoundState } from '../audio/director';
import type { Listener } from '../audio/spatial';
import { applyRefits, noRefits, type RefitLevels } from '../campaign/refits';
import { fortShipSpec } from '../data/forts/fort-model';
import { narrowsFortSpecs, narrowsMines, narrowsTerrain } from '../data/missions/narrows';
import { DAZZLE_SEED } from '../data/ships/markings';
import { paintOf, shipById, type ShipEntry, type ShipId } from '../data/ships/roster';
import type { Intent } from '../input/intent';
import type { Camera } from '../render/camera';
import type { SeaRenderer } from '../render/sea-renderer';
import { buildShip } from '../render/ships/forge/build-ship';
import { deckHeightAtX } from '../render/ships/forge/hull';
import type { ShipSpec } from '../render/ships/forge/spec';
import { AGGRESSIVE, CLOSING_GUNNER, DuelAi, STEADY_GUNNER, type AiProfile } from '../sim/combat/ai';
import { Arena } from '../sim/combat/arena';
import { Combatant, setupExtras, type BatteryUnit, type ShipReport } from '../sim/combat/combatant';
import { PlayerBot } from '../sim/combat/player-bot';
import type { ShipSetup } from '../sim/combat/setup';
import { pacedProfile, pacedSetup, REAL, type Pace } from '../sim/pace';
import { shellKind, type ShellKind } from '../sim/gunnery/shells';
import type { ReplaySample, ShellShot } from './replay';
import { penetrationEnvelope, type Envelope } from '../sim/damage/envelope';
import type { EnemyReadout } from '../ui/gunnery-hud';
import type { Environment } from '../sim/gunnery/ballistics';
import type { Contact, Gunnery, GunneryStatus } from '../sim/gunnery/gunnery';
import type { MuzzleShot } from '../sim/gunnery/battery';
import { shellAt, type ShellEvent } from '../sim/gunnery/shell-world';
import type { SalvoReport } from '../sim/gunnery/spotting';
import { Fort } from '../sim/fort/fort';
import { mountsFromSpec } from '../sim/gunnery/mounts';
import { SpotterPlane } from '../sim/air/spotter';
import { MineField } from '../sim/mines/mines';
import { Rng } from '../sim/rng';
import { kickSeed } from '../sim/ships/afloat';
import { TELEGRAPH_MIN } from '../sim/ships/dynamics';
import { Grounding } from '../sim/ships/grounding';
import type { Terrain } from '../sim/terrain/terrain';
import { shipPointToWorld, type ShipFrame } from '../sim/ships/frame';
import { SMOKE, type SmokeCloud } from '../sim/smoke/smoke-field';
import { aimTorpedoes, type TorpedoAim } from '../sim/torpedo/aim';
import { assessTorpedo, type ThreatView } from '../sim/torpedo/threat';
import { MAX_SPREAD_DEG } from '../sim/torpedo/tubes';
import type { Torpedo, TorpedoEvent } from '../sim/torpedo/world';
import { EnemyShip, type TargetPlan } from './enemy-ship';
import { FortActor } from './fort-actor';
import { MessageLog, type MessageTone } from './message-log';
import { PlayerShip } from './player-ship';
import type { ShipActor } from './ship-actor';

const DEG = Math.PI / 180;
const PLAYER_ID = 1;
const FIRST_ENEMY_ID = 2;
const FIRST_FORT_ID = 100;
/** Wind a little above the 10 m reading acts on a shell at height; the smoke feels roughly the surface wind. */
const SHELL_WIND_FACTOR = 1.15;
/** Director's eye and sight position when a ship's setup does not say: the foretop, ship space. */
const DIRECTOR_DEFAULT: readonly [number, number, number] = [17, 25, 0];
const LATITUDE_DEG = 52;
/** After the enemy is beaten, how long the fight plays on before the result is shown, seconds. */
const RESULT_DELAY = 7;
/** A ship that has struck must be left alone this long (no shell fired) before the fight is called over. */
const CEASE_FIRE_SECONDS = 6;
/** Metres between puffs of foam in a torpedo's wake. */
const WAKE_SPACING = 6;
/** A launch is called out to the bridge only if the boat is this near, metres, and not behind smoke. */
const LAUNCH_SIGHT = 9000;
/** Degrees of spread a step of the deflection control makes in torpedo mode. */
const SPREAD_STEP = 2;
/** Metres the sight must move the hand-laid aim before the elevation (a ballistic solution) is worked out again. */
const HAND_AIM_STEP = 40;
/** A fingerprint of the fight is kept every this many steps (ten seconds), for the test that two runs of one seed agree. */
const CHECKPOINT_TICKS = 600;

/** What the bridge calls a secondary battery, by its bore. */
function secondaryName(boreMm: number): string {
  if (boreMm < 100) return '12-PDRS';
  if (boreMm < 140) return '5.25-INCH';
  return '6-INCH';
}

export type ScenarioKind = 'duel' | 'destroyers' | 'narrows';

export interface ScenarioParams {
  /** Where the enemy starts: range from the player (km) and bearing off the player's bow (degrees, + starboard). */
  rangeKm: number;
  bearingDeg: number;
  /** The enemy's heading (compass degrees); by default she steams toward the player. */
  headingDeg?: number;
  /** A passive target for gunnery practice; absent, the enemy fights. */
  plan?: TargetPlan | null;
  enemyProfile?: AiProfile;
  /** A duel with one pre-dreadnought (the default) or a torpedo attack by a flotilla of destroyers. */
  kind?: ScenarioKind;
  /** How many destroyers come in the attack. */
  destroyers?: number;
  /** The ship she fights in a duel (default: the pre-dreadnought) and the destroyers that come with her. */
  foe?: ShipId;
  escorts?: number;
}

export const DEFAULT_SCENARIO: ScenarioParams = {
  rangeKm: 12,
  // Fine on the port bow: the chase camera starts looking about 20 degrees left of the bow, so she is in view.
  bearingDeg: -18,
};

export const DESTROYER_SCENARIO: ScenarioParams = {
  kind: 'destroyers',
  destroyers: 2,
  rangeKm: 9,
  bearingDeg: -18,
};

/** The Narrows: the ship against the shore batteries, the mines and the shoals, from the south end of the strait. */
export const NARROWS_SCENARIO: ScenarioParams = {
  kind: 'narrows',
  rangeKm: 0,
  bearingDeg: 0,
};

export type FightResult = 'victory' | 'defeat';

export interface Outcome {
  result: FightResult;
  /** One line on how it ended. */
  how: string;
  seconds: number;
  shellsFired: number;
  hitsScored: number;
  hitsTaken: number;
  /** Shells fired at a ship that had already struck her colours. */
  dishonour: number;
  /** The enemy was left afloat but helpless, not sunk or surrendered. */
  disabled: boolean;
  /** In a torpedo attack: the torpedoes fired at you and the hits they made. */
  torpedoes: { fired: number; hits: number } | null;
  /** Against the shore: batteries silenced, groundings and mines struck. */
  shore: { silenced: number; forts: number; groundings: number; mines: number } | null;
  /** How fit the ship is at the end, 0..1: the crew left, the water aboard, the power she has. */
  condition: number;
}

export interface GameOptions {
  seed?: number;
  /** The player's ship steers and fires itself with this profile (a demonstration, and the end-to-end tests). */
  autoPlayer?: 'steady' | 'closing' | 'evade' | null;
  /** What the dockyard has done to the ship (default: as built). */
  refits?: RefitLevels;
  /** The orders, posted to the log as the sortie begins. */
  objective?: string;
  /** The ship she commands (default: HMS Dreadnought). */
  player?: ShipId;
  /** Practice: nobody can win or lose, and no result is shown (the gunnery school). */
  practice?: boolean;
  /** How fast the world runs (default: the real pace). */
  pace?: Pace;
}

/** A wake the bridge has seen, running at the ship. */
export interface Threat extends ThreatView {
  id: number;
}

/** What the player's tubes could do now, for the torpedo HUD. */
export interface TorpedoSolution extends TorpedoAim {
  target: string;
  targetId: number;
  /** The plot is still being worked out, so the answer is only a guess. */
  rough: boolean;
}

export interface TorpedoStatus {
  mode: boolean;
  setting: { name: string; speed: number; range: number };
  spreadDeg: number;
  tubes: { id: string; loaded: boolean; reload: number; spare: number; enabled: boolean; bears: boolean }[];
  solution: TorpedoSolution | null;
  /** Torpedoes still in the water that are ours. */
  running: number;
  /** All the torpedoes left: loaded and spare. */
  remaining: number;
}

/** Everything the tactical plot shows, in world coordinates. */
export interface PlotView {
  own: { x: number; z: number; heading: number; speed: number; length: number };
  ships: { x: number; z: number; heading: number; length: number; small: boolean; alive: boolean; designated: boolean }[];
  torpedoes: { x: number; z: number; heading: number; ours: boolean; id: number; level: ThreatView['level'] | 'ours' }[];
  smoke: { x: number; z: number; r: number }[];
  /** The bow-relative arcs, radians, of the player's loaded tubes. */
  tubeArcs: [number, number][];
  /** Where the fan is expected to meet its target, while the tubes are in hand. */
  aim: { x: number; z: number } | null;
  /** The land, for the shoreline and the shoals; the batteries the player knows of; the mines that have been sighted; the aircraft. */
  land: Terrain | null;
  forts: { x: number; z: number; silenced: boolean; designated: boolean }[];
  mines: { x: number; z: number }[];
  plane: { x: number; z: number; heading: number } | null;
}

/** Everything that happens in the world: the ships and their guns, the torpedoes and shells in the water and air, and the effects. */
export class Game {
  readonly player: PlayerShip;
  readonly enemies: EnemyShip[] = [];
  readonly playerCombatant: Combatant;
  readonly arena: Arena;
  readonly messages = new MessageLog();
  readonly kind: ScenarioKind | null;
  /** The Narrows: the land, the batteries on it, the mines in the water and the aircraft overhead. */
  readonly terrain: Terrain | null;
  readonly forts: Fort[] = [];
  readonly mines: MineField | null;
  readonly plane: SpotterPlane | null;
  outcome: Outcome | null = null;
  simTime = 0;
  /** The tubes are the weapon in hand: FIRE launches torpedoes and the guns hold. */
  torpedoMode = false;

  private readonly lastTrail = new Map<number, number>();
  private pruneTimer = 0;
  private readonly project: [number, number] = [0, 0];
  /** Scratch for where a shell is drawn this frame. */
  private readonly shellPoint = { x: 0, y: 0, z: 0 };
  private readonly smokeClock = new Map<ShipActor, number>();
  private readonly fireClock = new Map<ShipActor, number>();
  private readonly lastStatus = new Map<ShipActor, string>();
  private readonly funnels = new Map<ShipSpec, (readonly [number, number, number])[]>();
  private readonly actors = new Map<Combatant, ShipActor>();
  private readonly autoAi: DuelAi | null;
  private readonly bot: PlayerBot | null;
  private beatenAt: number | null = null;
  private readonly announced = new Set<EnemyShip>();
  private lastShotAt = Number.NEGATIVE_INFINITY;
  private dishonour = 0;
  private seenSalvo = new Map<BatteryUnit, number>();
  /** A trigger pull seen by a rendered frame that ran no simulation step is kept until a step can act on it. */
  private triggerLatch = false;
  private torpedoLatch = false;
  private fireWasDown = false;
  private readonly wakeMarks = new Map<Torpedo, number>();
  private readonly screened = new WeakSet<SmokeCloud>();
  private screenCount = 0;
  private readonly lastLaunchCall = new Map<Combatant, number>();
  private readonly envelopes = new Map<ShipSetup, Envelope | null>();
  private readonly setups = new Map<Combatant, ShipSetup>();
  private readonly seed: number;
  private readonly practice: boolean;
  /** The random shove of a hit, drawn from the fight's own seed so that the fight is the same fight every time. */
  private readonly kickRng: Rng;
  /** A fingerprint of the state at every CHECKPOINT_TICKS steps, by step number: two runs of one seed must agree on every one. */
  readonly checkpoints = new Map<number, string>();
  readonly pace: Pace;
  /** The ship she commands, as built and refitted. */
  readonly playerSetup: ShipSetup;
  readonly playerEntry: ShipEntry;
  private readonly director: readonly [number, number, number];
  private readonly fortActors: FortActor[] = [];
  private readonly grounding: Grounding | null;
  /** Batteries the lookouts have found: a hidden one is known once its flash or the aircraft has shown it. */
  private readonly foundForts = new Set<Fort>();
  private readonly silencedCalled = new Set<Fort>();
  private groundings = 0;
  private mineHits = 0;
  private minesCalled = 0;
  private lastGroundedCall = Number.NEGATIVE_INFINITY;
  /** The crew's calls: the voices are made of these (see src/audio/voice.ts for what each is). */
  onVoice?: (key: string) => void;
  private readonly sighted = new Set<EnemyShip>();
  private readonly fireCalled = new Set<Combatant>();
  /** Where ships have gone down, and how fiercely the oil on the water burns there until it does not (seconds of simulation time). */
  private readonly aftermath: { x: number; z: number; until: number; length: number; power: number }[] = [];
  private readonly boilClock = new Map<ShipActor, number>();
  /** The turrets already seen to be wrecked ('<ship id>:<turret>'). */
  private readonly wreckSeen = new Set<string>();
  private lastSightCheck = Number.NEGATIVE_INFINITY;
  /** The last elevation worked out for the sight's hand-laid aim, and the range it was for. */
  private handAim: { range: number; elevation: number } | null = null;

  constructor(
    private readonly sea: SeaRenderer,
    scenario: ScenarioParams | null,
    options: GameOptions = {},
  ) {
    const seed = options.seed ?? 1914;
    this.seed = seed;
    this.kickRng = new Rng(kickSeed(seed));
    this.practice = options.practice === true;
    const pace = options.pace ?? REAL;
    this.pace = pace;
    const env = () => this.environment();
    const visibility = () => sea.params.visibilityKm;
    this.arena = new Arena(seed);
    this.kind = scenario ? (scenario.kind ?? 'duel') : null;
    this.terrain = this.kind === 'narrows' ? narrowsTerrain() : null;
    if (this.terrain) sea.setTerrain(this.terrain);

    // The ship as the dockyard has left her.
    this.playerEntry = shipById(options.player);
    const playerSetup = pacedSetup(applyRefits(this.playerEntry.setup, options.refits ?? noRefits()), pace);
    this.playerSetup = playerSetup;
    this.director = playerSetup.director ?? DIRECTOR_DEFAULT;
    // Her paint: the dockyard's dazzle scheme, if she has had it, over her own markings.
    const paint = paintOf(this.playerEntry);
    if ((playerSetup.dazzle ?? 0) > 0) paint.markings = { ...paint.markings, dazzle: DAZZLE_SEED[this.playerEntry.id] };
    this.player = new PlayerShip(sea, buildShip(this.playerEntry.spec), playerSetup.maxSpeedKn, paint, playerSetup.handling);
    this.player.helmRate *= pace.rudder;
    this.playerCombatant = new Combatant({
      id: PLAYER_ID,
      name: playerSetup.name,
      ship: playerSetup.ship,
      damage: playerSetup.damage,
      dynamics: this.player.dynamics,
      frame: () => this.player.frame,
      batteries: playerSetup.batteries,
      rangefinder: playerSetup.rangefinder,
      env,
      visibilityKm: visibility,
      seed,
      directorHeight: this.director[1],
      torpedoes: this.arena.torpedoes,
      smoke: this.arena.smoke,
      terrain: this.terrain ?? undefined,
      ...setupExtras(playerSetup),
    });
    this.playerCombatant.damage.canStrike = false;
    this.playerCombatant.torpedoSpread = 6;
    this.player.damage = this.playerCombatant.damage;
    this.player.battery = this.playerCombatant.main.battery;
    this.player.combatant = this.playerCombatant;
    this.arena.add(this.playerCombatant);
    this.actors.set(this.playerCombatant, this.player);
    this.setups.set(this.playerCombatant, playerSetup);
    if (options.objective) this.messages.push('info', `ORDERS: ${options.objective}`, 0);
    if (pace !== REAL) this.messages.push('info', `${pace.name.toUpperCase()} PACE: faster ships, quicker guns and a quicker plot.`, 0);

    if (scenario) {
      const fleet = this.enemyFleet(scenario);
      fleet.forEach((entry, i) => {
        const common = {
          id: FIRST_ENEMY_ID + i,
          seed: seed + 1 + i * 17,
          env,
          visibilityKm: visibility,
          foe: () => this.playerCombatant,
          torpedoes: this.arena.torpedoes,
          smoke: this.arena.smoke,
          paint: paintOf(entry),
        };
        const enemySetup = pacedSetup(entry.setup, pace);
        const enemy = new EnemyShip(
          sea,
          enemySetup,
          buildShip(entry.spec),
          entry.id === 'destroyer'
            ? { ...common, captain: 'destroyer' }
            : { ...common, plan: scenario.plan ?? null, profile: pacedProfile(scenario.enemyProfile ?? entry.profile ?? AGGRESSIVE, pace) },
        );
        enemy.combatant.setOpponents([this.playerCombatant]);
        this.enemies.push(enemy);
        this.arena.add(enemy.combatant);
        this.actors.set(enemy.combatant, enemy);
        this.setups.set(enemy.combatant, enemySetup);
      });
      this.playerCombatant.setOpponents(this.enemies.map((e) => e.combatant));
    }

    // The shore: forts on the hills, mines in the water, the aircraft aboard, and the bottom under the keel.
    this.mines = this.kind === 'narrows' ? narrowsMines() : null;
    this.plane = null;
    this.grounding = null;
    if (this.terrain) {
      const terrain = this.terrain;
      const hull = playerSetup.ship.hull;
      this.grounding = new Grounding(terrain, { length: hull.length, beam: hull.beam, draft: hull.draft });
      narrowsFortSpecs().forEach((spec, i) => {
        const fort = new Fort({
          spec,
          mounts: mountsFromSpec(fortShipSpec(spec)),
          terrain,
          env,
          visibilityKm: visibility,
          seed: seed + 301 + i * 13,
          id: FIRST_FORT_ID + i,
          pace,
        });
        fort.setOpponents([this.playerCombatant]);
        this.forts.push(fort);
        this.fortActors.push(new FortActor(sea, fort));
      });
      this.playerCombatant.setOpponents([...this.enemies.map((e) => e.combatant), ...this.forts]);
      this.playerCombatant.main.selectable = (c) => this.isKnown(c);
      this.plane = new SpotterPlane(
        { ship: () => ({ x: this.player.dynamics.x, z: this.player.dynamics.z }) },
        terrain,
        (x, z, r) => this.mines?.reveal(x, z, r) ?? 0,
        visibility,
        pace,
      );
      this.plane.onReveal = (n) => this.mineSighted(n);
      this.playerCombatant.setAerial(this.plane);
      for (const fort of this.forts) this.wireFort(fort);
    }

    const rng = new Rng(seed ^ 0x77);
    const profile = options.autoPlayer === 'steady' ? STEADY_GUNNER : options.autoPlayer === 'closing' ? CLOSING_GUNNER : null;
    this.autoAi = profile && this.enemies.length > 0 ? new DuelAi(this.playerCombatant, () => this.nearestEnemy(), profile, rng) : null;
    this.bot =
      options.autoPlayer === 'evade' && this.enemies.length > 0
        ? new PlayerBot(this.playerCombatant, () => this.enemies.map((e) => e.combatant), this.arena.torpedoes, 'head-on')
        : null;

    for (const c of this.combatants()) this.wire(c);
  }

  /** What the gunnery officer can make out of the designated enemy's condition. */
  enemyReadout(): EnemyReadout | null {
    const target = this.gunnery.target;
    const fort = target ? this.forts.find((f) => f === target) : undefined;
    if (fort) {
      const s = fort.summary();
      return {
        kind: 'fort',
        status: s.silenced ? 'silenced' : 'firing',
        speedKn: 0,
        turretsLost: s.total - s.guns,
        turretsTotal: s.total,
        fires: 0,
        listDeg: 0,
        crew: s.crew,
        flooding: false,
        suppression: s.suppression,
      };
    }
    const e = this.designatedEnemy();
    if (!e) return null;
    const c = e.combatant;
    const s = c.damage.summary();
    return {
      kind: 'ship',
      status: s.status,
      speedKn: Math.abs(e.dynamics.speed) / 0.514444,
      turretsLost: s.turretsLost,
      turretsTotal: s.turretsTotal,
      fires: s.fires,
      listDeg: s.listDeg,
      crew: s.crew,
      flooding: s.floodedT > 30,
    };
  }

  /** The first enemy, for the duel and for the tests. */
  get enemy(): EnemyShip | null {
    return this.enemies[0] ?? null;
  }

  private designatedEnemy(): EnemyShip | null {
    const t = this.gunnery.target;
    return (t && this.enemies.find((e) => e.combatant === t)) || null;
  }

  private nearestEnemy(): Combatant | null {
    const p = this.playerCombatant;
    let best: Combatant | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const e of this.enemies) {
      const c = e.combatant;
      if (!c.alive || c.struck) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  /** Where the player's shells defeat the designated enemy's armour; null for a thin-skinned craft or no target. */
  get envelope(): Envelope | null {
    const e = this.designatedEnemy();
    if (!e) return null;
    const setup = this.setups.get(e.combatant)!;
    if (setup.small) return null;
    let env = this.envelopes.get(setup);
    if (env === undefined) {
      const gun = this.playerSetup.batteries[0]!.gun;
      env = penetrationEnvelope(gun.shell, gun.maxElevationDeg * DEG, 8, setup.damage.armor);
      this.envelopes.set(setup, env);
    }
    return env;
  }

  /** The ships the scenario puts against the player: a flotilla of destroyers, a ship of the line and her escort, or nothing (the shore). */
  private enemyFleet(scenario: ScenarioParams): ShipEntry[] {
    if (this.kind === 'narrows') return [];
    const destroyer = shipById('destroyer');
    if (this.kind === 'destroyers') return Array.from({ length: Math.max(scenario.destroyers ?? 2, 1) }, () => destroyer);
    return [shipById(scenario.foe, 'hessen'), ...Array.from({ length: scenario.escorts ?? 0 }, () => destroyer)];
  }

  /** Put the enemies where the scenario says, relative to the player's present position and heading. */
  placeEnemy(scenario: ScenarioParams): void {
    const n = this.enemies.length;
    const p = this.player.frame;
    this.enemies.forEach((enemy, i) => {
      // A flotilla comes in on a front, a few degrees apart and a little staggered in range; a ship of the line comes on the
      // bearing, with her escort out on either bow of her, a mile or so nearer.
      const escort = this.kind === 'duel' && i > 0;
      const side = (i - 1) % 2 === 0 ? -1 : 1;
      const offset = this.kind === 'duel' ? (escort ? side * (14 + Math.floor((i - 1) / 2) * 10) : 0) : (i - (n - 1) / 2) * 26;
      const bearing = p.heading + (scenario.bearingDeg + offset) * DEG;
      const range = this.kind === 'duel' ? scenario.rangeKm * 1000 - (escort ? 1500 : 0) : scenario.rangeKm * 1000 + i * 700;
      const x = p.x + Math.sin(bearing) * range;
      const z = p.z - Math.cos(bearing) * range;
      // By default she heads for the player, a little off so she does not come straight down the line of fire.
      const towards = ((Math.atan2(p.x - x, -(p.z - z)) / DEG) % 360 + 360) % 360;
      enemy.start(x, z, scenario.headingDeg ?? towards);
    });
  }

  /** Everything the guns can be laid on: the ships, and the batteries that have been found. */
  get targets(): Contact[] {
    return [...this.enemies.map((e) => e.combatant), ...this.forts.filter((f) => this.isKnown(f))];
  }

  /** Is this contact one the player knows of? A battery behind a ridge is not until its flash or the aircraft has shown it. */
  isKnown(c: Contact): boolean {
    const fort = this.forts.find((f) => f === c);
    if (!fort) return true;
    return !fort.spec.hidden || fort.revealed(this.simTime) || this.foundForts.has(fort);
  }

  /** The ships in the order a replay records them: the player's first, then the others. */
  get replayShips(): ShipActor[] {
    return [this.player, ...this.enemies];
  }

  /** The player's heavy shells in the air, for the shell camera and the recorder, drawn `alpha` of the way through their last step. */
  playerShells(alpha = 1): ShellShot[] {
    const out: ShellShot[] = [];
    for (const b of this.playerCombatant.batteries) {
      if (b.setup.id !== 'main') continue;
      for (const sh of b.gunnery.world.shells) {
        const s = sh.state;
        const shot: ShellShot = { id: sh.id, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
        shellAt(sh, alpha, shot);
        out.push(shot);
      }
    }
    return out;
  }

  /** A sample of the picture for the recorder: where every ship is drawn and every turret points, the player's shells, the sea's clock. */
  replaySample(alpha = 1): ReplaySample {
    return { t: this.simTime, sea: this.sea.time, ships: this.replayShips.map((a) => a.shot()), shells: this.playerShells(alpha) };
  }

  /** The player's main-battery gunnery officer. */
  get gunnery(): Gunnery {
    return this.playerCombatant.main;
  }

  private combatants(): Combatant[] {
    return [this.playerCombatant, ...this.enemies.map((e) => e.combatant)];
  }

  private actorOf(c: Combatant): ShipActor {
    return this.actors.get(c)!;
  }

  // ---- wiring ------------------------------------------------------------------------------------

  private wire(c: Combatant): void {
    const ours = c === this.playerCombatant;
    c.onShot = (shot: MuzzleShot, unit: BatteryUnit) => {
      this.sea.fx.muzzleBlast(shot.muzzle, shot.direction, unit.setup.gun.shell.diameterM);
      if (ours) {
        this.lastShotAt = this.simTime;
        if (unit.gunnery.target?.struck) this.dishonour++;
        return;
      }
      // One warning per salvo from a big ship's main battery, for the player to watch the sea for.
      if (unit.setup.id === 'main' && !c.small && this.seenSalvo.get(unit) !== shot.salvo) {
        this.seenSalvo.set(unit, shot.salvo);
        this.say('warn', `${c.name} has fired a salvo.`);
      }
    };
    c.onShellEvent = (e: ShellEvent) => this.shellEvent(e);
    c.onHitMark = (mark) => {
      const actor = this.actorOf(c);
      actor.markHit(mark, this.simTime);
      // A shell that bursts in her is felt through the hull (the same shove the harnesses give their ships).
      actor.afloat.hitKick(this.kickRng, mark);
      if (ours && mark.kind === 'burst') this.cue('hit-taken');
    };
    if (ours) {
      c.onReport = (r: SalvoReport, unit: BatteryUnit) => {
        // The self-directing 12-pounders only report what they hit: their misses would drown the main battery's calls.
        if (unit.setup.id !== 'main') {
          if (r.call === 'HIT') this.say('good', `${unit.gunnery.target?.name ?? '12-pdrs'}: ${r.text}`);
          return;
        }
        this.say(r.call === 'HIT' ? 'good' : 'info', r.text);
        if (r.call === 'HIT') this.cue('hit');
        else if (r.call === 'STRADDLE') this.cue('straddle');
      };
    }
    c.onTorpedoLaunch = (t: Torpedo) => this.torpedoLaunched(c, t);
  }

  /** Hook a battery on the shore up to the effects and the log. */
  private wireFort(fort: Fort): void {
    let lastCall = Number.NEGATIVE_INFINITY;
    fort.onShot = (shot) => {
      this.sea.fx.muzzleBlast(shot.muzzle, shot.direction, fort.spec.gun.shell.diameterM);
      if (this.simTime - lastCall > 40) {
        lastCall = this.simTime;
        this.say('warn', `${fort.name} has opened fire.`);
        this.cue('battery-fired');
      }
    };
    fort.onShellEvent = (e) => this.shellEvent(e);
    fort.onReport = (text) => this.say('good', text);
  }

  private say(tone: MessageTone, text: string): void {
    this.messages.push(tone, text, this.simTime);
  }

  /** A call from the crew, for the voices. */
  private cue(key: string): void {
    this.onVoice?.(key);
  }

  /** The lookout calls each enemy ship the first time she is seen over the horizon. */
  private callSightings(): void {
    if (this.practice || this.simTime - this.lastSightCheck < 1) return;
    this.lastSightCheck = this.simTime;
    for (const e of this.enemies) {
      if (e.finished || this.sighted.has(e)) continue;
      if (this.gunnery.canSee(this.player.frame, e.combatant)) {
        this.sighted.add(e);
        this.cue('sighted');
      }
    }
  }

  private shellEvent(e: ShellEvent): void {
    const fx = this.sea.fx;
    const caliber = e.shell.spec.diameterM;
    if (e.kind === 'splash') {
      fx.shellSplash(e.x, e.z, caliber);
      if (e.diveHit) fx.hitBurst(e.diveHit.outcome.at[0], Math.max(e.diveHit.outcome.at[1], 0.5), e.diveHit.outcome.at[2], caliber * 0.6);
      return;
    }
    if (e.kind === 'ground') {
      fx.groundBurst(e.x, e.y, e.z, caliber);
      return;
    }
    const kind = e.outcome?.kind ?? 'burst';
    if (kind === 'burst') fx.hitBurst(e.x, e.y, e.z, caliber, shellKind(e.shell.spec));
    else if (kind === 'shatter') fx.armorSpark(e.x, e.y, e.z, caliber);
    else if (kind === 'ricochet') fx.armorSpark(e.x, e.y, e.z, caliber, true);
  }

  // ---- torpedoes ---------------------------------------------------------------------------------

  private bearingText(deg: number): string {
    return Math.round((deg + 360) % 360).toString().padStart(3, '0');
  }

  private torpedoLaunched(c: Combatant, t: Torpedo): void {
    this.sea.fx.torpedoLaunch(t.x, t.z);
    if (c === this.playerCombatant) {
      if (this.simTime - (this.lastLaunchCall.get(c) ?? -99) > 2) this.say('info', 'Torpedoes running.');
      this.lastLaunchCall.set(c, this.simTime);
      return;
    }
    // The lookouts see the boat's mounts train and the tubes fire, if she is near and not behind smoke.
    const p = this.playerCombatant;
    const range = Math.hypot(c.x - p.x, c.z - p.z);
    const clarity = this.arena.smoke.transmission(p.x, p.z, c.x, c.z);
    if (range > LAUNCH_SIGHT || clarity < 0.4) return;
    if (this.simTime - (this.lastLaunchCall.get(c) ?? -99) < 4) return;
    this.lastLaunchCall.set(c, this.simTime);
    const bearing = (Math.atan2(c.x - p.x, -(c.z - p.z)) / DEG + 360) % 360;
    this.cue('enemy-torpedoes');
    this.say('alert', `${c.name} has fired torpedoes! Bearing ${this.bearingText(bearing)}, ${Math.round(range / 10) * 10} m.`);
  }

  private torpedoEvents(events: readonly TorpedoEvent[]): void {
    const fx = this.sea.fx;
    for (const e of events) {
      if (e.kind === 'hit') {
        fx.torpedoBlast(e.x, e.z);
      } else if (e.kind === 'sighted') {
        if (e.by !== PLAYER_ID || e.torpedo.shooter === PLAYER_ID) continue;
        const p = this.playerCombatant;
        const bearing = (Math.atan2(e.torpedo.x - p.x, -(e.torpedo.z - p.z)) / DEG + 360) % 360;
        const rel = ((bearing - p.heading / DEG + 540) % 360) - 180;
        const side = rel >= 0 ? `${Math.round(rel)} off the starboard bow` : `${Math.round(-rel)} off the port bow`;
        this.cue(Math.abs(rel) < 15 ? 'torpedo-ahead' : rel >= 0 ? (rel <= 90 ? 'torpedo-stbd-bow' : 'torpedo-stbd-quarter') : rel >= -90 ? 'torpedo-port-bow' : 'torpedo-port-quarter');
        this.say('critical', `Torpedo wake! Bearing ${this.bearingText(bearing)}, ${Math.round(e.range / 10) * 10} m.${Math.abs(rel) > 90 ? '' : ` ${side}.`}`);
      } else if (e.kind === 'passed-under' && e.targetId === PLAYER_ID) {
        this.say('good', 'A torpedo has run under the keel!');
        this.cue('torpedo-passed');
      }
    }
  }

  /** The wakes the bridge has seen that are running at the ship, nearest to arriving first. */
  threats(): Threat[] {
    const p = this.playerCombatant;
    const own = { x: p.x, z: p.z, heading: p.heading, speed: p.dynamics.speed, halfLength: p.halfLength, halfBeam: p.halfBeam };
    const out: Threat[] = [];
    for (const t of this.arena.torpedoes.torpedoes) {
      if (t.shooter === PLAYER_ID || !t.seenBy.includes(PLAYER_ID)) continue;
      out.push({ id: t.id, ...assessTorpedo(t, own) });
    }
    return out.sort((a, b) => (a.eta ?? 9999) - (b.eta ?? 9999));
  }

  /** The player's tubes, ready or not, and the solution for the designated target. */
  torpedoStatus(): TorpedoStatus | null {
    const me = this.playerCombatant;
    const spec = me.cfg.torpedo;
    if (!me.tubes || !spec) return null;
    const setting = spec.settings[Math.min(me.torpedoSetting, spec.settings.length - 1)]!;
    let solution: TorpedoSolution | null = null;
    const target = this.gunnery.target;
    if (target) {
      const est = this.gunnery.track.estimate(this.simTime);
      if (est) {
        const aim = aimTorpedoes(me.dynamics, est, setting.speed, setting.range, me.tubes);
        if (aim) {
          solution = { ...aim, target: target.name, targetId: target.id, rough: est.samples < 4 || est.sigmaSpeed > 1.2 };
        }
      }
    }
    return {
      mode: this.torpedoMode,
      setting,
      spreadDeg: me.torpedoSpread,
      tubes: me.tubes.tubes.map((t, i) => ({
        id: t.spec.id,
        loaded: t.loaded,
        reload: t.reload,
        spare: t.spare,
        enabled: t.enabled,
        bears: solution !== null && me.tubes!.bears(i, solution.relative),
      })),
      solution,
      running: this.arena.torpedoes.torpedoes.filter((t) => t.shooter === PLAYER_ID).length,
      remaining: me.tubes.remaining,
    };
  }

  /** Fire the tubes that bear on the solution. */
  fireTorpedoes(): void {
    const me = this.playerCombatant;
    const status = this.torpedoStatus();
    if (!status?.solution) {
      this.say('warn', 'No firing solution: designate a target and let the plot settle.');
      return;
    }
    if (!status.solution.inReach) {
      this.say('warn', 'Target is beyond the torpedoes\' run.');
      return;
    }
    me.orderTubes(status.solution.relative);
    const n = me.fireTorpedoes(this.simTime);
    if (n === 0) this.say('warn', status.solution.loaded === 0 ? 'The tubes are empty.' : 'No tube bears.');
  }

  /** What the self-directing battery is doing, for the HUD: null when it has nothing to fire at. */
  secondaryReadout(): { name: string; range: number; guns: number; ready: number; firing: boolean; battery: string } | null {
    const me = this.playerCombatant;
    const id = me.cfg.autoTarget?.battery;
    const unit = id ? me.batteries.find((b) => b.setup.id === id) : undefined;
    const target = unit?.gunnery.target;
    if (!unit || !target) return null;
    const turrets = unit.gunnery.battery.status();
    const guns = turrets.filter((t) => t.enabled && t.bears).length;
    return {
      name: target.name,
      battery: secondaryName(unit.setup.gun.boreMm),
      range: Math.hypot(target.x - me.x, target.z - me.z),
      guns,
      ready: turrets.filter((t) => t.enabled && t.bears && t.loaded >= 1).length,
      firing: turrets.some((t) => t.firing),
    };
  }

  /** Everything the tactical plot draws. */
  plot(): PlotView {
    const p = this.playerCombatant;
    const target = this.gunnery.target;
    const visible = this.sea.params.visibilityKm * 1000;
    const threats = new Map(this.threats().map((t) => [t.id, t.level] as const));
    const aim = this.torpedoMode ? this.torpedoStatus()?.solution : null;
    return {
      own: { x: p.x, z: p.z, heading: p.heading, speed: p.dynamics.speed, length: p.halfLength * 2 },
      ships: this.enemies
        .filter((e) => Math.hypot(e.combatant.x - p.x, e.combatant.z - p.z) <= visible)
        .map((e) => ({
          x: e.combatant.x,
          z: e.combatant.z,
          heading: e.combatant.heading,
          length: e.combatant.halfLength * 2,
          small: e.combatant.small,
          alive: e.combatant.alive && !e.finished,
          designated: target === e.combatant,
        })),
      torpedoes: this.arena.torpedoes.torpedoes
        .filter((t) => t.shooter === PLAYER_ID || t.seenBy.includes(PLAYER_ID))
        .map((t) => ({
          x: t.x,
          z: t.z,
          heading: t.heading,
          ours: t.shooter === PLAYER_ID,
          id: t.id,
          level: t.shooter === PLAYER_ID ? ('ours' as const) : (threats.get(t.id) ?? ('clear' as const)),
        })),
      smoke: this.arena.smoke.clouds.map((c) => ({ x: c.x, z: c.z, r: c.radius })),
      tubeArcs: (p.tubes?.tubes ?? [])
        .filter((t) => t.enabled && t.loaded)
        .map((t) => [t.spec.arcDeg[0] * DEG, t.spec.arcDeg[1] * DEG] as [number, number]),
      aim: this.torpedoMode ? (aim ? { x: aim.aimX, z: aim.aimZ } : null) : null,
      land: this.terrain,
      forts: this.forts
        .filter((f) => this.isKnown(f))
        .map((f) => ({ x: f.x, z: f.z, silenced: f.silenced, designated: target === f })),
      mines: this.mines ? this.mines.mines.filter((m) => m.revealed && !m.exploded).map((m) => ({ x: m.x, z: m.z })) : [],
      plane: this.plane && this.plane.state === 'flying' ? { x: this.plane.x, z: this.plane.z, heading: this.plane.heading } : null,
    };
  }

  /** The real wind and Coriolis, from the sea settings. */
  private environment(): Environment {
    const p = this.sea.params;
    const h = p.waveHeadingDeg * DEG;
    return {
      windX: Math.sin(h) * p.windSpeed * SHELL_WIND_FACTOR,
      windZ: -Math.cos(h) * p.windSpeed * SHELL_WIND_FACTOR,
      coriolisLatitudeDeg: LATITUDE_DEG,
      densityScale: 1,
    };
  }

  /** The director's position in the world, for the sight camera and the horizon calculation. */
  directorPosition(): [number, number, number] {
    const pose = this.player.instance.pose;
    const h = pose.headingDeg * DEG;
    const [lx, ly] = this.director;
    // The sight is stabilised: it follows the ship's heading and heave, not its roll.
    return [pose.x + Math.sin(h) * lx, pose.heave + ly, pose.z - Math.cos(h) * lx];
  }

  // ---- input -------------------------------------------------------------------------------------

  /** One-shot orders from this frame's intent. Call once per rendered frame, before stepping. */
  applyIntent(intent: Intent, camera: Camera, sightUp: boolean): void {
    this.player.applyEdges(intent);
    if (intent.torpedoMode && this.playerCombatant.tubes) {
      this.torpedoMode = !this.torpedoMode;
      // Taking up the tubes with nothing designated picks the nearest enemy, as the gunnery officer would.
      if (this.torpedoMode && !this.gunnery.target) this.gunnery.cycle(1, this.player.frame);
    }
    // The trigger fires the weapon in hand. A torpedo salvo goes on the press, not while the trigger is held.
    if (this.torpedoMode) {
      if (intent.fire && !this.fireWasDown) this.torpedoLatch = true;
    } else if (intent.fire) this.triggerLatch = true;
    this.fireWasDown = intent.fire;

    const g = this.gunnery;
    const frame = this.player.frame;
    const env = this.environment();
    this.sea.fx.particles.wind = [env.windX / SHELL_WIND_FACTOR, env.windZ / SHELL_WIND_FACTOR];
    this.arena.smoke.wind = [env.windX / SHELL_WIND_FACTOR, env.windZ / SHELL_WIND_FACTOR];

    if (intent.spotter) this.toggleSpotter();
    if (intent.designateNdc) g.designate(this.pick(camera, intent.designateNdc[0], intent.designateNdc[1]));
    if (intent.cycleTarget !== 0) g.cycle(intent.cycleTarget, frame);
    if (this.torpedoMode) {
      // With the tubes in hand the spotting controls set the fan: deflection widens or closes it, auto-spot swaps the run speed.
      const me = this.playerCombatant;
      if (intent.deflectCorrect !== 0) me.torpedoSpread = Math.min(Math.max(me.torpedoSpread + intent.deflectCorrect * SPREAD_STEP, 0), MAX_SPREAD_DEG);
      if (intent.autoSpot && me.cfg.torpedo) me.torpedoSetting = (me.torpedoSetting + 1) % me.cfg.torpedo.settings.length;
    } else {
      if (intent.rangeCorrect !== 0 || intent.deflectCorrect !== 0) g.correct(intent.rangeCorrect, intent.deflectCorrect);
      if (intent.autoSpot) g.toggleAutoSpot();
    }
    if (intent.ceaseFire) g.ceaseFire();
    if (intent.shell === 'ap' || intent.shell === 'he') this.selectShell(intent.shell);
    else if (intent.cycleShell) this.selectShell(g.shell === 'ap' ? 'he' : 'ap');

    // Without a target the guns follow the sight.
    if (!g.target && sightUp) {
      const ray = camera.rayThrough(0, 0);
      const pos = camera.position;
      const max = g.cfgMaxRange();
      let range = max;
      if (ray[1] < -1e-4) range = Math.min((-pos[1] / ray[1]) * Math.hypot(ray[0], ray[2]), max);
      const azimuth = Math.atan2(ray[0], -ray[2]);
      // The elevation for a range is a ballistic solution, more than a millisecond's work: it is done again only when the sight has
      // moved the aim by more than a few lengths of a ship, which is finer than guns can be laid by hand anyway.
      const want = Math.max(range, 400);
      if (!this.handAim || Math.abs(want - this.handAim.range) > HAND_AIM_STEP) this.handAim = { range: want, elevation: g.elevationForRange(want) };
      g.setManualAim(azimuth, this.handAim.elevation);
    }
  }

  /** Load a kind of round in the main guns, for the next salvo, and say so on the bridge. */
  selectShell(kind: ShellKind): void {
    const g = this.gunnery;
    if (!g.shellChoice) {
      this.say('info', 'Her main guns fire only one round.');
      return;
    }
    if (g.shell === kind) return;
    this.playerCombatant.setShell(kind);
    this.say(
      'info',
      kind === 'he'
        ? 'HIGH-EXPLOSIVE loaded: bursts on contact. Good against upperworks, small ships and forts; weak against thick armour.'
        : 'ARMOUR-PIERCING loaded: pierces armour where the ruler is lit.',
    );
  }

  /** The contact nearest a click, if one is close enough to it on screen. */
  private pick(camera: Camera, ndcX: number, ndcY: number): Contact | null {
    let best: Contact | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const c of this.targets) {
      if (c.alive === false || !camera.project(c.x, 8, c.z, this.project)) continue;
      const dx = (this.project[0] - ndcX) * camera.aspect;
      const dy = this.project[1] - ndcY;
      const d = Math.hypot(dx, dy);
      const dist = Math.hypot(c.x - camera.position[0], c.z - camera.position[2]);
      // The hull's own size on screen, with a floor so a distant ship is still easy to hit with a finger.
      const half = c.halfLength / Math.max(dist, 1) / camera.tanHalfFovY;
      const reach = Math.max(0.09, half * 1.1);
      if (d < reach && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  // ---- the step ----------------------------------------------------------------------------------

  step(dt: number, intent: Intent, simTime: number): void {
    this.simTime = simTime;
    // Orders first: the captains decide, then every ship moves, then the guns and the damage have their turn.
    const enemyTriggers = this.enemies.map((e) => e.think(dt, simTime));
    let playerTriggers = [(intent.fire || this.triggerLatch) && !this.torpedoMode];
    this.triggerLatch = false;
    if (this.autoAi) playerTriggers = this.autoAi.update(simTime);
    else if (this.bot) playerTriggers = this.bot.update(simTime);
    else if (this.player.damage?.status === 'struck') playerTriggers = [false];

    if (this.torpedoMode && this.playerCombatant.tubes) {
      // The tubes follow the solution as the plot improves (fixed tubes only have the angle their gyros can give).
      const solution = this.torpedoStatus()?.solution;
      if (solution) this.playerCombatant.orderTubes(solution.relative);
    }
    if (this.torpedoLatch) {
      this.torpedoLatch = false;
      this.fireTorpedoes();
    }

    this.grounding?.begin(this.player.dynamics);
    if (this.autoAi || this.bot) this.player.step(dt, simTime);
    else this.player.stepWithHelm(dt, intent, simTime);
    this.keelCheck();
    for (const e of this.enemies) e.step(dt, simTime);

    const events = this.playerCombatant.step(dt, simTime, playerTriggers);
    this.enemies.forEach((e, i) => e.combatant.step(dt, simTime, enemyTriggers[i]!));
    // Every ship floats on the waves of this moment, with the shove of what she has just fired: on the fixed step, like all else
    // the guns are laid from, so that a fight does not depend on the frame rate.
    this.player.stepBody(dt, simTime);
    for (const e of this.enemies) e.stepBody(dt, simTime);

    this.torpedoEvents(this.arena.step(dt));
    if (this.terrain) this.shoreStep(dt, simTime, events);

    for (const c of this.combatants()) this.collectReports(c);
    this.judge();
    this.callSightings();
    const tick = Math.round(simTime * 60);
    if (tick % CHECKPOINT_TICKS === 0) this.checkpoints.set(tick, this.fingerprint());
  }

  /** The state of the fight in a line: where every ship is and how she lies, and what the guns have done. */
  private fingerprint(): string {
    const f = (v: number) => v.toFixed(5);
    const ship = (a: ShipActor) => {
      const d = a.dynamics;
      const fr = a.frame;
      return `${f(d.x)},${f(d.z)},${f(d.heading)},${f(d.speed)},${f(fr.y)},${f(fr.pitch)},${f(fr.roll)}`;
    };
    const p = this.playerCombatant;
    return [ship(this.player), ...this.enemies.map(ship), p.shellsFired, p.hitsScored, p.hitsTaken, this.arena.torpedoes.torpedoes.length].join('|');
  }

  /** Running aground: the shoal stops her where she is, and a strike at speed opens her bottom. */
  private keelCheck(): void {
    const g = this.grounding;
    if (!g) return;
    const draft = this.playerSetup.ship.hull.draft + this.playerCombatant.damage.sinkage * 0.5;
    const r = g.resolve(this.player.dynamics, draft);
    if (r.impactSpeed > 1) {
      this.groundings++;
      this.playerCombatant.damage.applyGrounding(r.at, r.impactSpeed);
    }
    if (g.grounded && this.simTime - this.lastGroundedCall > 25) {
      this.lastGroundedCall = this.simTime;
      this.say('alert', 'We are aground! Go astern to get her off.');
      this.cue('aground');
    }
  }

  /** The shore's part of a step: the aircraft, the batteries and their crews, and the mines. */
  private shoreStep(dt: number, now: number, events: readonly import('../sim/gunnery/shell-world').ShellEvent[]): void {
    const plane = this.plane;
    if (plane) {
      plane.update(dt);
      // It looks at what the gunnery officer is laid on, or else at the water ahead.
      const target = this.gunnery.target;
      if (target) plane.watch(target.x, target.z);
      else {
        const d = this.player.dynamics;
        plane.watch(d.x + Math.sin(d.heading) * 3500, d.z - Math.cos(d.heading) * 3500);
      }
      for (const fort of this.forts) {
        if (fort.spec.hidden && !this.foundForts.has(fort) && plane.sees(fort)) {
          this.foundForts.add(fort);
          const p = this.playerCombatant;
          const bearing = (Math.atan2(fort.x - p.x, -(fort.z - p.z)) / DEG + 360) % 360;
          this.cue('fort-found');
          this.say('good', `Spotter: ${fort.name} found, bearing ${this.bearingText(bearing)}, ${Math.round(Math.hypot(fort.x - p.x, fort.z - p.z) / 10) * 10} m.`);
        }
      }
    }
    for (const fort of this.forts) {
      const shots = fort.step(dt, now);
      void shots;
      // Where the ship's shells fall shakes the crews about them.
      for (const e of events) fort.receive(e);
      if (fort.silenced && !this.silencedCalled.has(fort)) {
        this.silencedCalled.add(fort);
        const left = this.forts.filter((f) => !f.silenced).length;
        this.cue('battery-silenced');
        this.say('good', `${fort.name} is silenced.${left > 0 ? ` ${left} battery${left === 1 ? '' : 'ies'} still firing.` : ''}`.replace('batteryies', 'batteries'));
      }
      // A hidden battery gives itself away by the flash of its guns.
      if (fort.spec.hidden && fort.revealed(now) && !this.foundForts.has(fort) && fort.shellsFired > 0) {
        this.foundForts.add(fort);
        this.say('alert', `${fort.name}: guns flash behind the ridge!`);
        this.cue('battery-flash');
      }
    }
    if (this.mines) {
      for (const hit of this.mines.step([this.playerCombatant.torpedoTarget])) {
        this.mineHits++;
        this.sea.fx.torpedoBlast(hit.mine.x, hit.mine.z);
      }
    }
  }

  private mineSighted(count: number): void {
    this.minesCalled += count;
    this.cue('mines');
    this.say('warn', `Spotter: mines sighted below us. ${this.minesCalled} marked on the chart.`);
  }

  /** The aircraft goes up, or is called home. */
  toggleSpotter(): void {
    const plane = this.plane;
    if (!plane) return;
    if (plane.state === 'deck') {
      if (plane.launch()) {
        this.say('info', 'Spotter aircraft is being hoisted out.');
        this.cue('airborne');
      }
      else this.say('warn', 'The aircraft is being readied: a few minutes before it can go up again.');
    } else if (plane.state === 'flying' || plane.state === 'launching') {
      plane.recall();
      this.say('info', 'Spotter recalled.');
      this.cue('returning');
    }
  }

  /** What the HUD says about the shore: the batteries, the mines found, the keel, the aircraft. Null away from a coast. */
  shoreStatus(): { forts: number; silenced: number; aground: boolean; mines: number; spotter: { state: string; fuel: number } | null } | null {
    if (!this.terrain) return null;
    return {
      forts: this.forts.length,
      silenced: this.forts.filter((f) => f.silenced).length,
      aground: this.grounding?.grounded ?? false,
      mines: this.mines ? this.mines.mines.filter((m) => m.revealed && !m.exploded).length : 0,
      spotter: this.plane ? { state: this.plane.state, fuel: Math.max(this.plane.fuel, 0) } : null,
    };
  }

  /** The aircraft's state for the HUD, or null when the ship carries none. */
  spotterStatus(): { label: string; on: boolean; fuel: number } | null {
    const plane = this.plane;
    if (!plane) return null;
    const names: Record<string, string> = { deck: plane.ready ? 'SPOTTER' : 'RESTING', launching: 'LAUNCHING', flying: 'RECALL', landing: 'LANDING' };
    return { label: names[plane.state] ?? 'SPOTTER', on: plane.state === 'flying' || plane.state === 'launching', fuel: Math.max(plane.fuel, 0) };
  }

  private collectReports(c: Combatant): void {
    const ours = c === this.playerCombatant;
    for (const r of c.drainReports()) this.report(r, ours, c.name);
  }

  private report(r: ShipReport, ours: boolean, name: string): void {
    const tone: MessageTone = r.tone === 'critical' ? 'critical' : r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'info';
    this.say(tone, ours ? r.text : `${name}: ${r.text.replace(/\bour\b/g, 'her')}`);
    if (ours && r.cue) this.cue(r.cue);
  }

  /** Decide whether the fight is over. */
  private judge(): void {
    if (this.outcome || this.practice) return;
    if (this.kind === 'narrows') {
      this.judgeShore();
      return;
    }
    if (this.enemies.length === 0) return;
    const me = this.playerCombatant.damage;

    if (me.status === 'sinking' || me.status === 'sunk' || me.status === 'exploded') {
      this.finish('defeat', me.status === 'exploded' ? 'Your magazines blew up.' : 'Your ship is lost.');
      return;
    }

    for (const e of this.enemies) {
      if (!e.finished || this.announced.has(e)) continue;
      this.announced.add(e);
      const name = e.combatant.name;
      const status = e.combatant.damage.status;
      if (status === 'struck') this.say('good', `${name} has struck her colours. Cease fire!`);
      else if (status === 'exploded') this.say('good', `${name} has blown up!`);
      else if (status === 'sinking' || status === 'sunk') this.say('good', `${name} is sinking.`);
      else if (status === 'crippled') this.say('good', `${name} is disabled! She cannot fight on.`);
      else this.say('good', `${name} has broken off the attack.`);
      this.cue(status === 'struck' ? 'enemy-struck' : status === 'exploded' ? 'enemy-blown' : status === 'sinking' || status === 'sunk' ? 'enemy-sinking' : status === 'crippled' ? 'enemy-disabled' : 'enemy-broke-off');
    }
    if (!this.enemies.every((e) => e.finished)) {
      this.beatenAt = null;
      return;
    }
    if (this.beatenAt === null) this.beatenAt = this.simTime;
    // Torpedoes already running can still do harm: the fight is not over until they have passed.
    if (this.arena.torpedoes.torpedoes.some((t) => t.shooter !== PLAYER_ID)) return;

    const since = this.simTime - this.beatenAt;
    const struck = this.enemies.some((e) => e.combatant.damage.status === 'struck');
    const quiet = this.simTime - this.lastShotAt > CEASE_FIRE_SECONDS && this.gunnery.world.shells.length === 0;
    const settled = struck ? (quiet && since > RESULT_DELAY) || since > 60 : since > RESULT_DELAY;
    if (!settled) return;

    if (this.kind === 'destroyers') {
      const sunk = this.enemies.filter((e) => ['sinking', 'sunk', 'exploded'].includes(e.combatant.damage.status)).length;
      const gone = this.enemies.filter((e) => e.combatant.damage.status === 'struck').length;
      const broke = this.enemies.length - sunk - gone;
      const parts = [sunk > 0 ? `${sunk} sunk` : '', gone > 0 ? `${gone} struck` : '', broke > 0 ? `${broke} driven off` : ''].filter(Boolean);
      this.finish('victory', `The torpedo attack is beaten: ${parts.join(', ')}.`);
      return;
    }
    const lead = this.enemies[0]!.combatant;
    const status = lead.damage.status;
    const how =
      status === 'struck'
        ? `${lead.name} struck her colours.`
        : status === 'exploded'
          ? `${lead.name} blew up.`
          : status === 'crippled'
            ? `${lead.name} is disabled: her guns are silent and she is helpless.`
            : `${lead.name} was sunk.`;
    this.finish('victory', how);
  }

  /** The Narrows is won when every battery is silenced, and lost when the ship is. */
  private judgeShore(): void {
    const me = this.playerCombatant.damage;
    if (me.status === 'sinking' || me.status === 'sunk' || me.status === 'exploded') {
      this.finish('defeat', me.status === 'exploded' ? 'Your magazines blew up.' : 'Your ship is lost.');
      return;
    }
    if (!this.forts.every((f) => f.silenced)) {
      this.beatenAt = null;
      return;
    }
    if (this.beatenAt === null) this.beatenAt = this.simTime;
    if (this.simTime - this.beatenAt > RESULT_DELAY && this.simTime - this.lastShotAt > CEASE_FIRE_SECONDS) {
      this.finish('victory', 'Every battery in the Narrows is silenced.');
    }
  }

  /** How fit the ship is: the crew that is left, the water aboard against what she can take, and the power she has. */
  private condition(): number {
    const s = this.playerCombatant.damage.summary();
    const afloat = 1 - Math.min(s.floodedT / Math.max(s.reserveT, 1), 1);
    return Math.min(Math.max(s.crew * afloat * (0.5 + 0.5 * s.power), 0), 1);
  }

  private finish(result: FightResult, how: string): void {
    const fired = this.enemies.reduce((n, e) => n + e.combatant.torpedoesLaunched, 0);
    this.outcome = {
      result,
      how,
      seconds: this.simTime,
      shellsFired: this.playerCombatant.shellsFired,
      hitsScored: this.playerCombatant.hitsScored,
      hitsTaken: this.playerCombatant.hitsTaken,
      dishonour: this.dishonour,
      condition: this.condition(),
      disabled: result === 'victory' && this.enemies[0]?.combatant.damage.status === 'crippled',
      torpedoes: this.kind === 'destroyers' ? { fired, hits: this.playerCombatant.torpedoHitsTaken } : null,
      shore:
        this.kind === 'narrows'
          ? { silenced: this.forts.filter((f) => f.silenced).length, forts: this.forts.length, groundings: this.groundings, mines: this.mineHits }
          : null,
    };
  }

  // ---- drawing -----------------------------------------------------------------------------------

  updateRender(alpha: number, dt: number): void {
    this.player.simNow = this.simTime;
    for (const e of this.enemies) e.simNow = this.simTime;
    this.player.updateRender(alpha, dt);
    for (const e of this.enemies) e.updateRender(alpha, dt);
    const fx = this.sea.fx;

    // Shells in flight: a bright speck each frame (where the shell is between steps, as the ships are drawn) and a little smoke now and then.
    if (dt > 0) {
      const at = this.shellPoint;
      for (const c of this.combatants()) {
        for (const b of c.batteries) {
          for (const shell of b.gunnery.world.shells) {
            const s = shell.state;
            const kind = shellKind(shell.spec);
            shellAt(shell, alpha, at);
            fx.tracer(at.x, at.y, at.z, kind);
            const slot = Math.floor(s.t / 0.12);
            const key = shell.id + (c === this.playerCombatant ? 0 : 1e9 * (c.id - 1)) + (b === c.batteries[0] ? 0 : 5e8);
            if (shell.spec.diameterM > 0.2 && this.lastTrail.get(key) !== slot) {
              this.lastTrail.set(key, slot);
              fx.tracerTrail(at.x, at.y, at.z, kind);
            }
          }
        }
      }
      this.pruneTimer += dt;
      if (this.pruneTimer > 2) {
        this.pruneTimer = 0;
        if (this.lastTrail.size > 400) this.lastTrail.clear();
      }
      for (const c of this.combatants()) {
        const actor = this.actorOf(c);
        this.emitFunnelSmoke(actor, c, dt);
        this.damageEffects(actor, c, dt);
      }
      this.torpedoEffects();
      this.shoreEffects(dt, alpha);
      this.aftermathEffects(dt);
    }
    for (const a of this.fortActors) a.updateRender();
  }

  private fortFireClock = 0;
  private aftermathClock = 0;

  /** The oil that a ship leaves on the water burns for a time, and its smoke stands over the place she went down. */
  private aftermathEffects(dt: number): void {
    if (this.aftermath.length === 0) return;
    this.aftermathClock += dt;
    if (this.aftermathClock < 0.35) return;
    this.aftermathClock = 0;
    const fx = this.sea.fx;
    for (let i = this.aftermath.length - 1; i >= 0; i--) {
      const a = this.aftermath[i]!;
      const left = a.until - this.simTime;
      if (left <= 0) {
        this.aftermath.splice(i, 1);
        continue;
      }
      // It burns hard at first and dies away: the intensity falls with the time left.
      const k = a.power * Math.min(left / 30, 1);
      const spread = a.length * 0.3;
      for (let j = 0; j < 2; j++) {
        const x = a.x + (Math.random() - 0.5) * spread;
        const z = a.z + (Math.random() - 0.5) * spread;
        fx.fireSmoke(x, 1.5, z, k);
        if (Math.random() < 0.7 * k) fx.flame(x, 1.2, z, k);
      }
    }
  }

  /** The land's side of the spectacle: shells from the batteries, their wrecks burning, the aircraft, the mines the aircraft has marked. */
  private shoreEffects(dt: number, alpha: number): void {
    const fx = this.sea.fx;
    const at = this.shellPoint;
    for (const f of this.forts) {
      for (const shell of f.gunnery.world.shells) {
        const s = shell.state;
        const kind = shellKind(shell.spec);
        shellAt(shell, alpha, at);
        fx.tracer(at.x, at.y, at.z, kind);
        const slot = Math.floor(s.t / 0.12);
        const key = shell.id + 2e9 * (f.id - FIRST_FORT_ID + 1);
        if (shell.spec.diameterM > 0.2 && this.lastTrail.get(key) !== slot) {
          this.lastTrail.set(key, slot);
          fx.tracerTrail(at.x, at.y, at.z, kind);
        }
      }
    }
    this.fortFireClock += dt;
    if (this.fortFireClock > 0.3) {
      this.fortFireClock = 0;
      for (const f of this.forts) {
        for (const e of f.emplacements) {
          if (e.state === 'wrecked') {
            fx.fireSmoke(e.worldX, f.base + 2, e.worldZ, 0.6);
            if (Math.random() < 0.4) fx.flame(e.worldX, f.base + 1.5, e.worldZ, 0.5);
          }
        }
      }
    }
    const plane = this.plane;
    if (plane && plane.state === 'flying') fx.aircraft(plane.x, 800, plane.z, plane.heading);
    if (this.mines) for (const m of this.mines.mines) if (m.revealed && !m.exploded) fx.mineMarker(m.x, m.z);
  }

  /** The foam in each torpedo's wake, and a billow for each new cloud of the smoke screens. */
  private torpedoEffects(): void {
    const fx = this.sea.fx;
    const live = new Set<Torpedo>();
    for (const t of this.arena.torpedoes.torpedoes) {
      live.add(t);
      let mark = this.wakeMarks.get(t);
      if (mark === undefined) mark = Math.max(t.run - WAKE_SPACING, 0);
      // Foam goes down at every few metres of its run, back along the track from where it is now.
      while (mark + WAKE_SPACING <= t.run) {
        mark += WAKE_SPACING;
        const back = t.run - mark;
        fx.torpedoWake(t.x - Math.sin(t.heading) * back, t.z + Math.cos(t.heading) * back);
      }
      this.wakeMarks.set(t, mark);
    }
    if (this.wakeMarks.size > live.size) for (const t of this.wakeMarks.keys()) if (!live.has(t)) this.wakeMarks.delete(t);

    // One cloud in three is drawn, and drawn bigger. A screen of translucent billows costs by the pixels it blends (the shading is
    // a small part of it: a cheaper shader measured no faster), so the way to make it cheap is fewer layers over the same sea.
    for (const c of this.arena.smoke.clouds) {
      if (this.screened.has(c)) continue;
      this.screened.add(c);
      if (this.screenCount++ % 3 === 0) fx.screenPuff(c.x, c.z, c.vx, c.vz, c.radius0 * 1.7, SMOKE.radiusDeath * 1.1, c.life);
    }
  }

  /** Where the ship is drawn right now, as a frame for placing things on her. */
  private drawnFrame(actor: ShipActor): ShipFrame {
    const frame = actor.frame;
    const p = actor.instance.pose;
    return { ...frame, x: p.x, z: p.z, y: p.heave, heading: (p.headingDeg * Math.PI) / 180, pitch: p.pitch, roll: p.roll };
  }

  private funnelTops(spec: ShipSpec): (readonly [number, number, number])[] {
    let tops = this.funnels.get(spec);
    if (!tops) {
      tops = spec.funnels.map((f) => [f.x, deckHeightAtX(spec.hull, f.x) + f.height, f.z ?? 0] as const);
      this.funnels.set(spec, tops);
    }
    return tops;
  }

  /** Funnel smoke: a few puffs a second per funnel, more when the engines are working, none from a dead ship. */
  private emitFunnelSmoke(actor: ShipActor, c: Combatant, dt: number): void {
    const dmg = c.damage;
    if (dmg.status === 'sunk' || dmg.status === 'exploded') return;
    const d = actor.dynamics;
    const power = Math.min(Math.abs(d.orderedSpeed) / (d.handling.maxSpeedKn * 0.514444 * Math.max(dmg.power, 0.05)), 1) * dmg.power;
    const perSecond = 1.4 + 3.4 * power;
    let clock = (this.smokeClock.get(actor) ?? 0) + dt * perSecond * (dmg.status === 'struck' ? 0.4 : 1);
    if (clock < 1) {
      this.smokeClock.set(actor, clock);
      return;
    }
    const frame = actor.frame;
    const drawn = this.drawnFrame(actor);
    while (clock >= 1) {
      clock -= 1;
      this.funnelTops(c.cfg.ship).forEach(([fx, fy, fz], i) => {
        const w = shipPointToWorld(drawn, [fx, fy, fz]);
        this.sea.fx.funnelPuff(w[0], w[1], w[2], frame.vx, frame.vz, power);
        // A funnel shot through smokes from the hole as well, low down on her side, where the draught is lost.
        if ((dmg.funnels[i] ?? 1) < 0.5) {
          const leak = shipPointToWorld(drawn, [fx, fy - 6, fz + (i % 2 === 0 ? 1.8 : -1.8)]);
          this.sea.fx.funnelPuff(leak[0], leak[1], leak[2], frame.vx, frame.vz, 0.6 * power + 0.3);
        }
      });
    }
    this.smokeClock.set(actor, clock);
  }

  /** Fires, the glare of a magazine going up, and a note when she changes state. */
  private damageEffects(actor: ShipActor, c: Combatant, dt: number): void {
    const dmg = c.damage;
    const fx = this.sea.fx;
    const status = dmg.status;
    const before = this.lastStatus.get(actor);
    if (before !== status) {
      this.lastStatus.set(actor, status);
      const drawn = this.drawnFrame(actor);
      if (status === 'exploded') {
        // She breaks in two where the magazine went up.
        actor.breakUp(dmg.explosionX, this.simTime);
        const w = shipPointToWorld(drawn, [dmg.explosionX, 6, 0]);
        fx.explosion(w[0], w[1], w[2], c.cfg.ship.hull.length / 160);
      } else if (status === 'sinking' && before !== undefined) {
        this.say('critical', c === this.playerCombatant ? 'We are sinking!' : `${c.name} is going down.`);
        if (c === this.playerCombatant) this.cue('sinking');
      } else if (status === 'sunk' && before !== undefined) {
        // She has gone: the water boils over her, wreckage and oil are left, and what burns on the oil goes on burning for a while.
        const L = c.cfg.ship.hull.length;
        fx.shipLost(c.x, c.z, L);
        const burning = before === 'exploded' ? 1 : Math.min(dmg.fires / 3, 1) * 0.7;
        if (burning > 0.05) this.aftermath.push({ x: c.x, z: c.z, until: this.simTime + 40 + 50 * burning, length: L, power: burning });
      }
    }
    if (status === 'sunk') return;

    // As she settles the water churns white over her hull.
    if (status === 'sinking' || status === 'exploded') {
      const clock = (this.boilClock.get(actor) ?? 0) + dt;
      if (clock >= 0.6) {
        this.boilClock.set(actor, clock - 0.6);
        const L = c.cfg.ship.hull.length;
        const w = shipPointToWorld(this.drawnFrame(actor), [(Math.random() - 0.5) * L * 0.8, 0, (Math.random() - 0.5) * 6]);
        fx.boil(w[0], w[2], Math.max(L / 150, 0.4));
      } else this.boilClock.set(actor, clock);
    }

    // A turret that has just been wrecked goes up in a small explosion of its own.
    for (const t of dmg.turrets) {
      if (t.state !== 'destroyed') continue;
      const key = `${c.id}:${t.id}`;
      if (this.wreckSeen.has(key)) continue;
      this.wreckSeen.add(key);
      const ref = actor.model.turrets.find((r) => r.id === t.id);
      if (!ref) continue;
      const pivot = actor.model.nodes[ref.houseNode]!.pivot;
      const w = shipPointToWorld(this.drawnFrame(actor), [pivot[0], pivot[1] + 2, pivot[2]]);
      fx.turretWreck(w[0], w[1], w[2], Math.min(Math.max(c.cfg.ship.hull.length / 170, 0.4), 1.2));
    }

    const sites = dmg.fireSites();
    if (sites.length > 0 && c !== this.playerCombatant && !this.fireCalled.has(c)) {
      this.fireCalled.add(c);
      this.cue('enemy-fire');
    }
    if (sites.length === 0 && status !== 'exploded') return;
    const clock = (this.fireClock.get(actor) ?? 0) + dt;
    const step = 0.16;
    if (clock < step) {
      this.fireClock.set(actor, clock);
      return;
    }
    this.fireClock.set(actor, clock - step);
    const drawn = this.drawnFrame(actor);
    for (const s of sites) {
      const w = shipPointToWorld(drawn, actor.carryPoint(s.at));
      fx.fireSmoke(w[0], w[1], w[2], s.intensity);
      if (s.intensity > 0.2) fx.flame(w[0], w[1], w[2], s.intensity);
    }
    if (status === 'exploded') {
      // The wreck burns from end to end as she goes down, and fiercest along the two torn ends where the magazine went.
      const L = c.cfg.ship.hull.length;
      for (let i = 0; i < 3; i++) {
        const w = shipPointToWorld(drawn, actor.carryPoint([(Math.random() - 0.5) * L * 0.7, 4, (Math.random() - 0.5) * 8]));
        fx.fireSmoke(w[0], w[1], w[2], 1);
        fx.flame(w[0], w[1], w[2], 1);
      }
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const w = shipPointToWorld(drawn, actor.carryPoint([dmg.explosionX + side * Math.random() * 6, 1 + Math.random() * 7, (Math.random() - 0.5) * 16]));
        fx.fireSmoke(w[0], w[1], w[2], 1);
        if (Math.random() < 0.8) fx.flame(w[0], w[1], w[2], 1);
      }
    }
  }

  // ---- sound -------------------------------------------------------------------------------------

  private readonly soundSunk = new Set<Combatant>();
  private lastSunkAt: [number, number] | null = null;

  /** What the sound director hears of the fight: the player's engines and hull, the fires, the enemy's shells coming down. */
  soundState(listener: Listener, timeScale: number, paused: boolean): SoundState {
    const p = this.playerCombatant;
    const d = p.dynamics;
    const dist = (x: number, z: number): number => Math.hypot(x - listener.x, z - listener.z);
    let fireDistance = Infinity;
    let fires = 0;
    const incoming: SoundState['incoming'] = [];
    for (const c of this.combatants()) {
      if (c.damage.alive && c.damage.fires > 0) {
        fires++;
        fireDistance = Math.min(fireDistance, dist(c.x, c.z));
      }
      if ((c.damage.status === 'sinking' || c.damage.status === 'sunk') && !this.soundSunk.has(c)) {
        this.soundSunk.add(c);
        this.lastSunkAt = [c.x, c.z];
      }
      if (c === p) continue;
      c.batteries.forEach((b, bi) => {
        for (const shell of b.gunnery.world.shells) {
          const st = shell.state;
          const distance = Math.hypot(st.x - p.x, st.z - p.z);
          if (distance < 900) incoming.push({ id: `${c.id}.${bi}.${shell.salvo}.${shell.id}`, distance, falling: st.vy < 0 });
        }
      });
    }
    const turrets = this.status().turrets.filter((t) => t.enabled && t.bears);
    const slewing = turrets.length > 0 ? turrets.filter((t) => !t.aligned && !t.firing).length / turrets.length : 0;
    return {
      listener,
      timeScale,
      paused,
      speedFrac: Math.min(Math.abs(d.speedKnots) / d.handling.maxSpeedKn, 1),
      power: Math.abs(d.handling.telegraphFraction[d.telegraph - TELEGRAPH_MIN] ?? 0) * d.powerFactor,
      telegraph: d.telegraph,
      wind: this.sea.params.windSpeed,
      fireDistance,
      fires,
      turretMotion: slewing,
      flooding: p.damage.alive && p.damage.floodedTonnes > 50,
      damage: Math.min(1, 1 - p.damage.crewFraction + 0.1 * p.damage.fires),
      turning: Math.abs(d.yawRate) > 0.015,
      incoming,
      threats: this.threats().length,
      sunk: this.soundSunk.size,
      sunkDistance: this.lastSunkAt ? dist(this.lastSunkAt[0], this.lastSunkAt[1]) : Infinity,
      planeDistance: this.plane?.flying ? dist(this.plane.x, this.plane.z) : null,
    };
  }

  // ---- views -------------------------------------------------------------------------------------

  status(): GunneryStatus {
    return this.gunnery.status(this.player.frame);
  }

  /** How high above her waterline the director's lens is, ship space, metres (where the sight's cutaway is centred). */
  get directorHeight(): number {
    return this.director[1];
  }

  get playerFrame(): ShipFrame {
    return this.player.frame;
  }

  /** The seed this fight was started with. */
  get fightSeed(): number {
    return this.seed;
  }
}
