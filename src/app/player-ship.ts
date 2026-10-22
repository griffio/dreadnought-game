import type { Intent } from '../input/intent';
import type { SeaRenderer } from '../render/sea-renderer';
import type { ShipModel } from '../render/ships/forge/spec';
import type { ShipPaint } from '../render/ships/ship-renderer';
import type { GunBattery } from '../sim/gunnery/battery';
import type { HandlingOverrides } from '../sim/ships/dynamics';
import { ShipActor } from './ship-actor';

const DEG = Math.PI / 180;
const RECOIL_METRES = 1.15;
const RIPPLE_SECONDS = 0.28;
/** How fast a held rudder key turns the wheel, in rudder-lock fractions per second. */
const HELM_RATE = 0.55;

/**
 * The player's ship: a ship actor with a helm. Its turrets follow the gun battery once one is attached; without one
 * (the showcase URLs) they run the old demonstration animations: sweep, hold, and a recoil on request.
 */
export class PlayerShip extends ShipActor {
  sweep = false;
  /** Hold every turret at this train (from rest) and elevation, degrees, when not sweeping. */
  hold: { trainDeg: number; elevDeg: number } | null = null;
  battery: GunBattery | null = null;

  private clock = 0;
  private salvoStart = Number.POSITIVE_INFINITY;
  private readonly turretState = new Map<string, { train: number; elev: number }>();

  constructor(sea: SeaRenderer, model: ShipModel, maxSpeedKn = 21, paint?: Partial<ShipPaint>, handling?: HandlingOverrides) {
    super(sea, model, maxSpeedKn, paint, handling);
    for (const t of model.turrets) this.turretState.set(t.id, { train: t.restTrainDeg * DEG, elev: 0 });
  }

  /** One-shot orders from this frame's intent: telegraph and absolute wheel. Call once per rendered frame. */
  applyEdges(intent: Intent): void {
    if (intent.telegraphSet !== null) this.dynamics.setTelegraph(intent.telegraphSet);
    if (intent.telegraphStep !== 0) this.dynamics.stepTelegraph(intent.telegraphStep);
    if (intent.helmSet !== null) this.dynamics.setRudderOrder(intent.helmSet);
  }

  /** Advance the simulation by one fixed step, with held-key rudder from the intent. */
  stepWithHelm(dt: number, intent: Intent, simTime: number): void {
    if (intent.helmRate !== 0) this.dynamics.setRudderOrder(this.dynamics.rudderOrder + intent.helmRate * HELM_RATE * dt);
    this.step(dt, simTime);
  }

  /** Showcase salvo: with a battery attached every loaded turret fires for real, otherwise just the recoil animation. */
  fire(): void {
    if (this.battery) {
      this.battery.fireAll();
      return;
    }
    this.salvoStart = this.clock;
    this.body.kick(-0.012, 0.004);
  }

  /** Per rendered frame: float on the waves and animate turrets. */
  override updateRender(alpha: number, dt: number): void {
    super.updateRender(alpha, dt);
    this.clock += dt;
    // In a fight the base class lays the turrets on the combatant's guns; the showcase URLs run the demonstrations below.
    if (this.combatant && !this.sweep && !this.hold) return;
    const battery = this.battery;
    if (battery && !this.sweep && !this.hold) {
      const kick = battery.drainKick();
      if (kick.roll !== 0 || kick.pitch !== 0) this.body.kick(kick.roll, kick.pitch);
      battery.turrets.forEach((t, i) => {
        this.instance.rig.setTurret(t.mount.id, t.train, t.elev);
        const ref = this.model.turrets[i]!;
        ref.barrelNodes.forEach((_, g) => this.instance.rig.setRecoil(t.mount.id, g, battery.recoil(i, g)));
      });
      return;
    }

    const ease = 1 - Math.exp(-dt * 2.2);
    this.model.turrets.forEach((t, i) => {
      const s = this.turretState.get(t.id)!;
      const rest = t.restTrainDeg * DEG;
      const h = this.hold;
      const targetTrain = this.sweep ? rest + 55 * DEG * Math.sin(this.clock * 0.32 + i * 0.9) : rest + (h ? h.trainDeg * DEG : 0);
      const targetElev = this.sweep ? (7 + 5 * Math.sin(this.clock * 0.5 + i)) * DEG : h ? h.elevDeg * DEG : 0;
      s.train += (targetTrain - s.train) * ease;
      s.elev += (targetElev - s.elev) * ease;
      this.instance.rig.setTurret(t.id, s.train, s.elev);

      const since = this.clock - this.salvoStart - i * RIPPLE_SECONDS;
      let stroke = 0;
      if (since > 0) stroke = since < 0.1 ? since / 0.1 : Math.exp(-(since - 0.1) / 0.85);
      t.barrelNodes.forEach((_, g) => this.instance.rig.setRecoil(t.id, g, stroke * RECOIL_METRES * (g % 2 ? 0.96 : 1)));
    });
  }
}
