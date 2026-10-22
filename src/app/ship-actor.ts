import type { SeaRenderer, WakeSource } from '../render/sea-renderer';
import type { Combatant } from '../sim/combat/combatant';
import type { ShipDamage } from '../sim/damage/ship-damage';
import type { ShipModel } from '../render/ships/forge/spec';
import type { ShipInstance, ShipPaint } from '../render/ships/ship-renderer';
import { BATTLESHIP_FLOATING, FloatingBody, fitWaterPlane } from '../sim/ships/buoyancy';
import { handlingFor, KNOT, ShipDynamics, type HandlingOverrides } from '../sim/ships/dynamics';
import type { ShipFrame } from '../sim/ships/frame';
import { WakeHistory, type WakeShip } from '../sim/ships/wake';
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
 * A ship in the world: manoeuvring dynamics stepped on the fixed simulation clock, wave-following on the render clock,
 * and a wake. The player's ship and every other ship are these; they differ in who gives the orders.
 */
export class ShipActor implements WakeSource {
  readonly dynamics: ShipDynamics;
  readonly instance: ShipInstance;
  readonly body: FloatingBody;
  readonly history = new WakeHistory();
  readonly ship: WakeShip;
  readonly hull: WakeSource['hull'];

  protected prev = { x: 0, z: 0, heading: 0 };
  /** What has happened to her: she lists, settles and finally goes under as it grows. */
  damage: ShipDamage | null = null;
  /** Her guns and tubes, when she fights: the turrets in the picture follow them. */
  combatant: Combatant | null = null;
  private gone = false;
  private readonly turretIds: ReadonlySet<string>;

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
    this.body = new FloatingBody(BATTLESHIP_FLOATING(model.length, model.beam));
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

  /** Velocity over the ground, m/s. */
  get velocity(): [number, number] {
    const d = this.dynamics;
    return [Math.sin(d.heading) * d.speed, -Math.cos(d.heading) * d.speed];
  }

  /** The ship as the gunnery simulation sees it: current position, attitude and velocity. */
  get frame(): ShipFrame {
    const d = this.dynamics;
    const [vx, vz] = this.velocity;
    return { x: d.x, y: this.body.heave, z: d.z, heading: d.heading, pitch: this.body.pitch, roll: this.body.roll, vx, vz };
  }

  /** Interpolated state for the wake and the camera. */
  state(): { x: number; z: number; headingDeg: number; speed: number } {
    const p = this.instance.pose;
    return { x: p.x, z: p.z, headingDeg: p.headingDeg, speed: this.dynamics.speed };
  }

  /** Lay the turrets in the picture on the guns and tubes of the combatant: train, elevation, recoil, and the kick of a broadside. */
  protected followGuns(): void {
    const c = this.combatant;
    if (!c) return;
    for (const unit of c.batteries) {
      const battery = unit.gunnery.battery;
      const kick = battery.drainKick();
      if (kick.roll !== 0 || kick.pitch !== 0) this.body.kick(kick.roll, kick.pitch);
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
  }

  /** Add the wake her stern left at time `t`, as a replay has her. */
  wakeAt(t: number, s: ShipShot): void {
    const aft = this.model.length * STERN_FRACTION;
    const h = s.headingDeg * DEG;
    this.history.record(s.x - Math.sin(h) * aft, s.z + Math.cos(h) * aft, t, s.speed, s.power);
  }

  /** Per rendered frame: interpolate the pose and float on the waves. */
  updateRender(alpha: number, dt: number): void {
    const d = this.dynamics;
    const pose = this.instance.pose;
    pose.x = this.prev.x + (d.x - this.prev.x) * alpha;
    pose.z = this.prev.z + (d.z - this.prev.z) * alpha;
    const heading = lerpAngle(this.prev.heading, d.heading, alpha);
    pose.headingDeg = ((((heading * 180) / Math.PI) % 360) + 360) % 360;

    const plane = fitWaterPlane(
      (x, z) => this.sea.waveHeightAt(x, z),
      pose.x,
      pose.z,
      pose.headingDeg,
      this.model.length,
      this.model.beam,
    );
    const dm = this.damage;
    this.body.update(dt, plane, d.turnHeel + (dm?.list ?? 0), dm?.trim ?? 0, dm?.sinkage ?? 0);
    if (dm && dm.status === 'sunk' && !this.gone) {
      this.gone = true;
      this.instance.visible = false;
      this.sea.removeWake(this);
    }
    pose.heave = this.body.heave;
    pose.pitch = this.body.pitch;
    pose.roll = this.body.roll;
    this.followGuns();
  }
}
