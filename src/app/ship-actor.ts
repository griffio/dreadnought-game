import type { SeaRenderer, WakeSource } from '../render/sea-renderer';
import type { Combatant } from '../sim/combat/combatant';
import { TUNING, type ShipDamage } from '../sim/damage/ship-damage';
import type { ShipModel } from '../render/ships/forge/spec';
import type { ShipInstance, ShipPaint } from '../render/ships/ship-renderer';
import type { FireSite } from '../render/ships/fires';
import { flagStreaming, rippleAt } from '../render/ships/flags';
import { carry, sectionMatrix } from '../render/ships/section';
import { Afloat } from '../sim/ships/afloat';
import type { FloatingBody } from '../sim/ships/buoyancy';
import { handlingFor, KNOT, ShipDynamics, type HandlingOverrides } from '../sim/ships/dynamics';
import type { ShipFrame } from '../sim/ships/frame';
import { WakeHistory, type WakeShip } from '../sim/ships/wake';
import { decalsForHit, type HitMark } from '../render/ships/decals';
import type { ShipShot } from './replay';

const DEG = Math.PI / 180;
/** Where the propellers are, as a fraction of the length aft of amidships. */
const STERN_FRACTION = 0.44;
const TWO_PI = Math.PI * 2;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

/**
 * A ship in the world: manoeuvring dynamics and wave-following, both stepped on the fixed simulation clock (so that a fight is the
 * same fight at any frame rate: her roll and pitch are the guns' platform), and a wake. The player's ship and every other ship are these; they differ in who gives the orders.
 */
export class ShipActor implements WakeSource {
  readonly dynamics: ShipDynamics;
  readonly instance: ShipInstance;
  /** Her hull on the waves: the same body the headless harnesses float their ships with. */
  readonly afloat: Afloat;
  readonly history = new WakeHistory();
  readonly ship: WakeShip;
  readonly hull: WakeSource['hull'];

  protected prev = { x: 0, z: 0, heading: 0 };
  /** How she lay in the water at the start of the last step, for drawing her between steps. */
  private prevBody = { heave: 0, pitch: 0, roll: 0 };
  /** What has happened to her: she lists, settles and finally goes under as it grows. */
  damage: ShipDamage | null = null;
  /** Her guns and tubes, when she fights: the turrets in the picture follow them. */
  combatant: Combatant | null = null;
  private gone = false;
  private readonly turretIds: ReadonlySet<string>;
  /** The simulation clock, set by the game each frame (the break-up runs on it, so it keeps pace with the game and a replay). */
  simNow = 0;
  /** A ship that has broken in two: where she broke (ship-space x) and when (simulation time). */
  private broken: { x: number; at: number } | null = null;
  /** The part of her aft of the break, drawn as a second instance of the same model. */
  private stern: ShipInstance | null = null;
  /** The direction her flags stream in, in ship space (radians from the bow, + starboard): it follows the wind she makes, a little late. */
  private flagAngle = Math.PI;
  /** For the perf survey: her hurt as shown, whatever her damage model says (these fires, these turrets wrecked). */
  private showcase: { fires: readonly FireSite[]; wreck: readonly string[] } | null = null;
  /** The split as it was last drawn, for the recorder. */
  private split: { x: number; age: number; sunk: number } | null = null;

  constructor(
    protected readonly sea: SeaRenderer,
    readonly model: ShipModel,
    maxSpeedKn = 21,
    paint?: Partial<ShipPaint>,
    handling?: HandlingOverrides,
  ) {
    this.dynamics = new ShipDynamics(handlingFor(model.length, maxSpeedKn, handling));
    this.instance = sea.addShip(model);
    if (paint) this.instance.paint = { ...this.instance.paint, ...paint };
    this.afloat = new Afloat(model.length, model.beam, sea.buoyancyWaves);
    this.turretIds = new Set(model.turrets.map((t) => t.id));
    this.ship = { beam: model.beam, referenceSpeed: maxSpeedKn * KNOT };
    this.hull = { length: model.length, halfBreadthAt: model.waterlineHalfBreadthAt };
    sea.addWake(this);
  }

  /** Place the ship (also clears the wake). */
  setPosition(x: number, z: number, headingDeg: number): void {
    this.dynamics.x = x;
    this.dynamics.z = z;
    this.dynamics.heading = headingDeg * DEG;
    this.prev = { x, z, heading: this.dynamics.heading };
    this.history.clear();
    this.instance.pose.x = x;
    this.instance.pose.z = z;
    this.instance.pose.headingDeg = ((headingDeg % 360) + 360) % 360;
  }

  /** Advance the manoeuvring simulation by one fixed step and lay down wake. */
  step(dt: number, simTime: number): void {
    const d = this.dynamics;
    this.prev = { x: d.x, z: d.z, heading: d.heading };
    d.step(dt);
    const aft = this.model.length * STERN_FRACTION;
    this.history.record(
      d.x - Math.sin(d.heading) * aft,
      d.z + Math.cos(d.heading) * aft,
      simTime,
      d.speed,
      Math.abs(d.orderedSpeed) / this.ship.referenceSpeed,
    );
  }

  /**
   * Float her on the waves for one fixed step: the water under her hull at this moment of the simulation, the lean of a turn, her list,
   * trim and settling, and the kicks of her own guns. After the guns have been stepped (their recoil is drained here).
   */
  stepBody(dt: number, simTime: number): void {
    const b = this.body;
    this.prevBody.heave = b.heave;
    this.prevBody.pitch = b.pitch;
    this.prevBody.roll = b.roll;
    // On a sea pinned for a picture she floats on the pinned waves, so that the picture and the hull agree.
    this.afloat.step(dt, this.sea.waveTime(simTime), this.dynamics, this.damage, this.kickers());
  }

  /** The guns whose recoil she feels: her combatant's batteries. */
  protected kickers(): { drainKick(): { roll: number; pitch: number } }[] {
    return (this.combatant?.batteries ?? []).map((unit) => unit.gunnery.battery);
  }

  /** Her heave, pitch and roll (and the impulses that disturb them). */
  get body(): FloatingBody {
    return this.afloat.body;
  }

  /** Velocity over the ground, m/s. */
  get velocity(): [number, number] {
    const d = this.dynamics;
    return [Math.sin(d.heading) * d.speed, -Math.cos(d.heading) * d.speed];
  }

  /** The ship as the gunnery simulation sees it: current position, attitude and velocity. */
  get frame(): ShipFrame {
    return this.afloat.frame(this.dynamics);
  }

  /** Interpolated state for the wake and the camera. */
  state(): { x: number; z: number; headingDeg: number; speed: number } {
    const p = this.instance.pose;
    return { x: p.x, z: p.z, headingDeg: p.headingDeg, speed: this.dynamics.speed };
  }

  /** Lay the turrets in the picture on the guns and tubes of the combatant: train, elevation and recoil. */
  protected followGuns(): void {
    const c = this.combatant;
    if (!c) return;
    for (const unit of c.batteries) {
      const battery = unit.gunnery.battery;
      battery.turrets.forEach((t, i) => {
        const ref = this.model.turrets.find((r) => r.id === t.mount.id);
        if (!ref) return;
        this.instance.rig.setTurret(ref.id, t.train, t.elev);
        ref.barrelNodes.forEach((_, g) => this.instance.rig.setRecoil(ref.id, g, battery.recoil(i, g)));
      });
    }
    for (const tube of c.tubes?.tubes ?? []) {
      // A deck mounting is a turret in the picture; a submerged tube has no part to turn.
      if (this.turretIds.has(tube.spec.id)) this.instance.rig.setTurret(tube.spec.id, tube.bearing, 0);
    }
  }

  /** Her magazine has blown up: she breaks in two at ship-space `x`, and the halves go down apart. */
  breakUp(x: number, now: number): void {
    if (this.broken) return;
    this.broken = { x, at: now };
  }

  /** For the perf survey: show her badly hurt (or as her damage model has her, for null). */
  setShowcase(s: { fires: readonly FireSite[]; wreck: readonly string[] } | null): void {
    for (const id of this.showcase?.wreck ?? []) this.instance.rig.repair(id);
    this.showcase = s;
  }

  /** For the perf survey: break her in two at ship-space x, or make her whole again (null). */
  debugBreak(x: number | null, now: number): void {
    this.broken = x === null ? null : { x, at: now };
    if (x === null) {
      this.split = null;
      this.showSplit(null);
    }
  }

  get isBroken(): boolean {
    return this.broken !== null;
  }

  /** Where a ship-space point is in the picture now: carried with whichever half of her it lies on if she has broken, else where it was. */
  carryPoint(p: readonly [number, number, number]): [number, number, number] {
    const b = this.broken;
    if (!b) return [p[0], p[1], p[2]];
    const part = p[0] >= b.x ? this.instance : this.stern;
    return part?.section ? carry(part.section, p) : [p[0], p[1], p[2]];
  }

  /** Put the halves of a broken ship where `split` says (or make her whole, for null). */
  private showSplit(split: { x: number; age: number; sunk: number } | null): void {
    const bow = this.instance;
    if (!split) {
      bow.split = { x: 0, side: 0, ragged: 0, age: 0 };
      bow.section = null;
      if (this.stern) {
        this.stern.visible = false;
        this.stern.split = { x: 0, side: 0, ragged: 0, age: 0 };
        this.stern.section = null;
      }
      return;
    }
    if (!this.stern) {
      this.stern = this.sea.addShipSection(bow);
      this.stern.pose = bow.pose;
    }
    const stern = this.stern;
    bow.split = { x: split.x, side: 1, ragged: 2.6, age: split.age };
    stern.split = { x: split.x, side: -1, ragged: 2.6, age: split.age };
    bow.section ??= new Float32Array(16);
    stern.section ??= new Float32Array(16);
    sectionMatrix(1, split.x, split.age, split.sunk, bow.section);
    sectionMatrix(-1, split.x, split.age, split.sunk, stern.section);
    stern.visible = bow.visible;
  }

  /**
   * Her flags stream along the wind as she feels it: the true wind less her own motion (the flags fly aft when she steams in a calm and
   * stream to leeward in a breeze at rest). `dt` eases them round, so that a turn does not snap them.
   */
  private streamFlags(headingDeg: number, speed: number, dt: number): void {
    const p = this.sea.params;
    const wind = flagStreaming(headingDeg, speed, p.waveHeadingDeg, p.windSpeed);
    this.flagAngle = dt > 0 ? lerpAngle(this.flagAngle, wind.angle, 1 - Math.exp(-dt * 3)) : wind.angle;
    this.instance.rig.setFlags(this.flagAngle);
    this.instance.flutter = rippleAt(wind.speed);
  }

  /** A shell has struck her: the marks it leaves (scorch, a hole) are carried on her hull from now on. */
  markHit(mark: HitMark, now: number): void {
    for (const d of decalsForHit(mark, now)) this.instance.decals.add(d);
  }

  // ---- replay -------------------------------------------------------------------------------------

  /** How she looks now, for the recorder: where she is drawn, how she lies in the waves and where her turrets point. */
  shot(): ShipShot {
    const p = this.instance.pose;
    const d = this.dynamics;
    return {
      x: p.x,
      z: p.z,
      headingDeg: p.headingDeg,
      heave: p.heave,
      pitch: p.pitch,
      roll: p.roll,
      speed: Math.abs(d.speed),
      power: Math.abs(d.orderedSpeed) / this.ship.referenceSpeed,
      visible: this.instance.visible,
      guns: this.instance.rig.snapshot(),
      fires: this.instance.fireCount > 0 ? Array.from(this.instance.fires.subarray(0, this.instance.fireCount * 4)) : undefined,
      split: this.split ?? undefined,
      coloursDown: this.instance.rig.coloursDown || undefined,
    };
  }

  /** Lay her as a replay says she was. (Her own simulation is not stepped while a replay runs.) */
  lay(s: ShipShot): void {
    const p = this.instance.pose;
    p.x = s.x;
    p.z = s.z;
    p.headingDeg = s.headingDeg;
    p.heave = s.heave;
    p.pitch = s.pitch;
    p.roll = s.roll;
    this.instance.visible = s.visible;
    this.instance.rig.restore(s.guns);
    this.instance.setFiresRaw(s.fires ?? []);
    this.showSplit(s.split ?? null);
    this.instance.rig.hauledDown(s.coloursDown === true);
    this.streamFlags(s.headingDeg, s.speed, 0);
  }

  /** Add the wake her stern left at time `t`, as a replay has her. */
  wakeAt(t: number, s: ShipShot): void {
    const aft = this.model.length * STERN_FRACTION;
    const h = s.headingDeg * DEG;
    this.history.record(s.x - Math.sin(h) * aft, s.z + Math.cos(h) * aft, t, s.speed, s.power);
  }

  /** Per rendered frame: draw her where she is between steps (position, heading, and how she lies in the water). */
  updateRender(alpha: number, dt: number): void {
    const d = this.dynamics;
    const pose = this.instance.pose;
    pose.x = this.prev.x + (d.x - this.prev.x) * alpha;
    pose.z = this.prev.z + (d.z - this.prev.z) * alpha;
    const heading = lerpAngle(this.prev.heading, d.heading, alpha);
    pose.headingDeg = ((((heading * 180) / Math.PI) % 360) + 360) % 360;
    const dm = this.damage;
    if (dm && dm.status === 'sunk' && !this.gone) {
      this.gone = true;
      this.instance.visible = false;
      this.sea.removeWake(this);
    }
    if (this.broken) {
      this.split = { x: this.broken.x, age: this.simNow - this.broken.at, sunk: (dm?.sunkDepth ?? 0) / TUNING.sunkDepth };
      this.showSplit(this.split);
    }
    const b = this.body;
    const pb = this.prevBody;
    pose.heave = pb.heave + (b.heave - pb.heave) * alpha;
    pose.pitch = pb.pitch + (b.pitch - pb.pitch) * alpha;
    pose.roll = pb.roll + (b.roll - pb.roll) * alpha;
    this.followGuns();
    this.showDamage();
    this.streamFlags(pose.headingDeg, Math.abs(d.speed), dt);
  }

  /** What has happened to her shows on her: a wrecked turret is blown apart and charred, and her fires light her hull. */
  private showDamage(): void {
    if (this.showcase) {
      for (const id of this.showcase.wreck) this.instance.rig.wreck(id);
      this.instance.setFires(this.showcase.fires);
      return;
    }
    const dm = this.damage;
    if (!dm) return;
    for (const t of dm.turrets) if (t.state === 'destroyed') this.instance.rig.wreck(t.id);
    this.instance.setFires(dm.fireSites());
    // A ship that has struck her colours has hauled them down.
    this.instance.rig.hauledDown(dm.status === 'struck');
  }
}
