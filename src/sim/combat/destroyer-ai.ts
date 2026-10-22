import { azimuthTo } from '../gunnery/fire-control';
import type { Rng } from '../rng';
import { rudderForCourse } from '../ships/autopilot';
import { TELEGRAPH } from '../ships/dynamics';
import { interceptCourse } from '../torpedo/intercept';
import type { Combatant } from './combatant';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export type DestroyerState = 'approach' | 'attack' | 'retire' | 'escaped' | 'beaten';

export interface DestroyerProfile {
  /** Range at which she wants to fire, metres, and how far ahead of and abeam the target she takes station. */
  attackRange: number;
  stationAhead: number;
  stationAbeam: number;
  /** Errors in her reckoning of the target: course (degrees, one sigma) and speed (m/s). */
  aimSigmaDeg: number;
  speedSigma: number;
  /** Alteration of course either way while closing, degrees, and seconds between changes. */
  weaveDeg: number;
  weavePeriod: number;
  /** Metres between torpedoes at the target: the fan opens just enough to lay them along her length. */
  spacing: number;
  /** Whether she makes smoke as she retires. */
  laysSmoke: boolean;
  /** After she has fired everything she runs; once this far off she is gone for good, metres. */
  escapeRange: number;
}

export const TORPEDO_ATTACK: DestroyerProfile = {
  attackRange: 3200,
  stationAhead: 1800,
  stationAbeam: 2800,
  aimSigmaDeg: 1.0,
  speedSigma: 0.7,
  weaveDeg: 9,
  weavePeriod: 25,
  spacing: 110,
  escapeRange: 14000,
  laysSmoke: true,
};

/**
 * A torpedo boat's captain. She runs in at full speed toward a firing position ahead of and abeam of her target, weaving to
 * spoil the target's gunnery, turns her mounts onto the intercept course and fires a fan, then retires; if she has torpedoes
 * left she comes back. Her aim is the true course and speed of the target spoiled by honest errors, not a cheat.
 */
export class DestroyerAi {
  state: DestroyerState = 'approach';
  private side: 1 | -1;
  private course = 0;
  private nextWeave: number;
  private weaveSign = 1;
  private nextThink = 0;
  private designated = false;
  private volleysThisRun = 0;
  private lastVolley = Number.NEGATIVE_INFINITY;
  /** The errors in her reckoning, drawn once per run so they are a consistent mistake rather than noise. */
  private aimError = 0;
  private speedError = 0;

  constructor(
    private readonly me: Combatant,
    private readonly foe: () => Combatant | null,
    readonly profile: DestroyerProfile,
    private readonly rng: Rng,
  ) {
    this.side = rng.next() < 0.5 ? 1 : -1;
    this.nextWeave = profile.weavePeriod * (0.4 + rng.next());
    this.course = me.dynamics.heading;
  }

  update(now: number): boolean[] {
    const me = this.me;
    const foe = this.foe();
    const idle = me.batteries.map(() => false);
    if (!foe || !me.damage.floating) return idle;
    if (me.damage.status === 'struck') {
      this.state = 'beaten';
      me.dynamics.setTelegraph(TELEGRAPH.STOP);
      return idle;
    }
    const d = me.dynamics;
    if (!this.designated) {
      for (const b of me.batteries) {
        b.gunnery.designate(foe);
        b.gunnery.autoSpot = true;
      }
      this.designated = true;
    }

    const dx = foe.x - me.x;
    const dz = foe.z - me.z;
    const range = Math.hypot(dx, dz);
    const bearing = azimuthTo(dx, dz);

    if (now >= this.nextThink) {
      this.nextThink = now + 1;
      this.think(now, foe, range, bearing);
    }
    d.setRudderOrder(rudderForCourse(d, this.course));
    if (this.state === 'attack') this.aimTubes(foe);

    const guns = me.batteries.map((b) => b.gunnery.canReach && b.gunnery.track.count >= 5 && range < 7000);
    return guns;
  }

  private think(now: number, foe: Combatant, range: number, bearing: number): void {
    const me = this.me;
    const p = this.profile;
    const d = me.dynamics;
    const tubes = me.tubes;
    const left = tubes?.remaining ?? 0;
    d.setTelegraph(TELEGRAPH.FLANK);

    if (left === 0 && this.state !== 'escaped') this.state = range > p.escapeRange ? 'escaped' : 'retire';
    if (this.state === 'escaped') {
      me.makingSmoke = false;
      d.setTelegraph(TELEGRAPH.STOP);
      return;
    }

    switch (this.state) {
      case 'approach': {
        // Make for a firing position ahead of and abeam of the target.
        const ahead = foe.heading;
        const px = foe.x + Math.sin(ahead) * p.stationAhead + Math.cos(ahead) * this.side * p.stationAbeam;
        const pz = foe.z - Math.cos(ahead) * p.stationAhead + Math.sin(ahead) * this.side * p.stationAbeam;
        this.course = azimuthTo(px - me.x, pz - me.z);
        if (range < p.attackRange * 1.25 || Math.hypot(px - me.x, pz - me.z) < 500) {
          this.state = 'attack';
          this.volleysThisRun = 0;
          this.aimError = this.rng.gaussian() * p.aimSigmaDeg * DEG;
          this.speedError = this.rng.gaussian() * p.speedSigma;
        }
        break;
      }
      case 'attack': {
        // Hold a course that closes on the firing range and fire as the mounts come on.
        this.course = bearing + this.side * 75 * DEG;
        if (range > p.attackRange * 1.8) this.state = 'approach';
        const ready = tubes?.ready().length ?? 0;
        if (ready > 0 && now - this.lastVolley > 1.5) this.volley(now, foe);
        // She stays for the reload and a second volley, then runs.
        if (this.volleysThisRun >= 2 || left === 0) this.state = 'retire';
        break;
      }
      case 'retire': {
        // Turn away, and keep going.
        this.course = bearing + Math.PI + this.side * 30 * DEG;
        if (range > p.escapeRange * 0.6 && left > 0 && (tubes?.loadedCount ?? 0) > 0) this.state = 'approach';
        break;
      }
      default:
        break;
    }
    // She lays a screen as she turns away, between herself and the guns.
    me.makingSmoke = this.state === 'retire' && p.laysSmoke;
    // Weave while closing.
    if (this.state === 'approach' && p.weaveDeg > 0) {
      if (now >= this.nextWeave) {
        this.weaveSign = -this.weaveSign;
        this.nextWeave = now + p.weavePeriod * (0.6 + 0.8 * this.rng.next());
      }
      this.course += this.weaveSign * p.weaveDeg * DEG;
    }
    this.course = ((this.course % TWO_PI) + TWO_PI) % TWO_PI;
  }

  /** The intercept the captain reckons: the target's true motion, spoiled by his consistent errors. */
  private solution(foe: Combatant, settingSpeed: number): { bearing: number; time: number } | null {
    const me = this.me;
    const speed = Math.hypot(foe.vx, foe.vz);
    const course = Math.atan2(foe.vx, -foe.vz) + this.aimError;
    const s = Math.max(speed + this.speedError, 0);
    const sol = interceptCourse(me.x, me.z, foe.x, foe.z, Math.sin(course) * s, -Math.cos(course) * s, settingSpeed);
    return sol ? { bearing: sol.heading - me.dynamics.heading, time: sol.time } : null;
  }

  private aimTubes(foe: Combatant): void {
    const me = this.me;
    const spec = me.cfg.torpedo;
    if (!spec || !me.tubes) return;
    const setting = spec.settings[me.torpedoSetting]!;
    const sol = this.solution(foe, setting.speed);
    if (sol) me.orderTubes(sol.bearing);
  }

  private volley(now: number, foe: Combatant): void {
    const me = this.me;
    const spec = me.cfg.torpedo!;
    const range = Math.hypot(foe.x - me.x, foe.z - me.z);
    // The fast setting when she is close, the slow one with the legs for a longer run.
    me.torpedoSetting = range < 4000 ? 0 : 1;
    const loaded = me.tubes?.ready().length ?? 1;
    me.torpedoSpread = loaded > 1 ? ((loaded - 1) * this.profile.spacing / range) / DEG : 0;
    const sol = this.solution(foe, spec.settings[me.torpedoSetting]!.speed);
    if (!sol || sol.time * spec.settings[me.torpedoSetting]!.speed > spec.settings[me.torpedoSetting]!.range) return;
    me.orderTubes(sol.bearing);
    const n = me.fireTorpedoes(now);
    if (n > 0) {
      this.volleysThisRun++;
      this.lastVolley = now;
    }
  }
}
