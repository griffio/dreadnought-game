import { azimuthTo } from '../gunnery/fire-control';
import type { Rng } from '../rng';
import { rudderForCourse } from '../ships/autopilot';
import { TELEGRAPH } from '../ships/dynamics';
import type { Combatant } from './combatant';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export type AiState = 'approach' | 'engage' | 'withdraw' | 'beaten';

/** How a captain fights: the range he likes, how he handles the ship, how he jinks, when he has had enough. */
export interface AiProfile {
  /** Range band, metres, that he tries to hold. */
  rangeMin: number;
  rangeMax: number;
  /** Degrees off the line of bearing that he approaches by: it opens his broadside as he comes. */
  approachAngle: number;
  /** Telegraph orders while closing and while engaged. */
  approachTelegraph: number;
  engageTelegraph: number;
  /** Alteration of course, degrees either way, and seconds between them, to spoil the enemy's plot. 0 = hold course. */
  jinkDeg: number;
  jinkPeriod: number;
  /** He breaks off when his ship's condition falls below this (0..1). */
  withdrawBelow: number;
  /** Seconds between decisions. */
  thinkPeriod: number;
}

export const AGGRESSIVE: AiProfile = {
  rangeMin: 4200,
  rangeMax: 7200,
  approachAngle: 10,
  approachTelegraph: TELEGRAPH.FULL_AHEAD,
  engageTelegraph: TELEGRAPH.HALF_AHEAD,
  jinkDeg: 8,
  jinkPeriod: 80,
  withdrawBelow: 0.35,
  thinkPeriod: 2,
};

/** A High Seas Fleet captain in 1916: closes to the range where his flat, fast shells and his fine sights tell, and fights on a steady course. */
export const HIGH_SEAS_FLEET: AiProfile = {
  rangeMin: 8500,
  rangeMax: 12500,
  approachAngle: 15,
  approachTelegraph: TELEGRAPH.FULL_AHEAD,
  engageTelegraph: TELEGRAPH.HALF_AHEAD,
  jinkDeg: 6,
  jinkPeriod: 90,
  withdrawBelow: 0.35,
  thinkPeriod: 2,
};

/** Bismarck's Admiral: opens the range at once and fights at it, at full speed, as a ship that out-gunned and out-ranged her pursuers. */
export const BISMARCK_CAPTAIN: AiProfile = {
  rangeMin: 12500,
  rangeMax: 18000,
  approachAngle: 12,
  approachTelegraph: TELEGRAPH.FULL_AHEAD,
  engageTelegraph: TELEGRAPH.FULL_AHEAD,
  jinkDeg: 10,
  jinkPeriod: 70,
  withdrawBelow: 0.3,
  thinkPeriod: 2,
};

/** A ship that cannot steer: her captain can only keep the guns firing and the engines turning. */
export const CRIPPLED_CAPTAIN: AiProfile = {
  rangeMin: 0,
  rangeMax: 1e9,
  approachAngle: 0,
  approachTelegraph: TELEGRAPH.HALF_AHEAD,
  engageTelegraph: TELEGRAPH.HALF_AHEAD,
  jinkDeg: 0,
  jinkPeriod: 60,
  withdrawBelow: 0,
  thinkPeriod: 2,
};

/** A steady player-ship bot for balancing: holds the range at which his guns beat hers, steady course, no jinking. */
export const STEADY_GUNNER: AiProfile = {
  rangeMin: 8500,
  rangeMax: 11500,
  approachAngle: 30,
  approachTelegraph: TELEGRAPH.FULL_AHEAD,
  engageTelegraph: TELEGRAPH.HALF_AHEAD,
  jinkDeg: 0,
  jinkPeriod: 60,
  withdrawBelow: 0,
  thinkPeriod: 2,
};

/** A bolder player-ship bot: closes to where its guns hit hard, and takes what the casemates give back. */
export const CLOSING_GUNNER: AiProfile = {
  rangeMin: 4500,
  rangeMax: 6500,
  approachAngle: 20,
  approachTelegraph: TELEGRAPH.FULL_AHEAD,
  engageTelegraph: TELEGRAPH.HALF_AHEAD,
  jinkDeg: 0,
  jinkPeriod: 60,
  withdrawBelow: 0,
  thinkPeriod: 2,
};

/**
 * The captain and the gunnery officer of a ship the player does not control. The captain steers to fight at the range he
 * wants, with his broadside to the enemy; the gunnery officer is the ordinary `Gunnery` chain (rangefinder, plot, solution,
 * fall-of-shot corrections), with errors set by the crew's skill, not by cheating.
 */
export class DuelAi {
  state: AiState = 'approach';
  private side: 1 | -1 = 1;
  private nextThink = 0;
  private jinkSign = 1;
  private nextJink: number;
  private course = 0;
  private designated = false;

  constructor(
    private readonly me: Combatant,
    private readonly foe: () => Combatant | null,
    readonly profile: AiProfile,
    private readonly rng: Rng,
  ) {
    this.nextJink = profile.jinkPeriod * (0.5 + this.rng.next());
    this.course = me.dynamics.heading;
  }

  /** Steer and decide; returns the triggers to hold for each battery. */
  update(now: number): boolean[] {
    const me = this.me;
    const foe = this.foe();
    const idle = me.batteries.map(() => false);
    if (!foe || !me.damage.floating) return idle;
    const d = me.dynamics;

    if (!this.designated) {
      for (const b of me.batteries) {
        // A battery that chooses its own targets (anti-destroyer guns) is not pointed at a battleship.
        if (me.cfg.autoTarget?.battery === b.setup.id) continue;
        b.gunnery.designate(foe);
        b.gunnery.autoSpot = true;
      }
      this.designated = true;
      this.side = this.rng.next() < 0.5 ? 1 : -1;
    }

    // A ship that has struck is not fired on, and a wreck is no longer a target.
    if (foe.damage.status === 'struck' || !foe.alive) return idle;

    if (me.damage.status === 'struck') {
      this.state = 'beaten';
      d.setTelegraph(TELEGRAPH.STOP);
      return idle;
    }

    if (now >= this.nextThink) {
      this.nextThink = now + this.profile.thinkPeriod;
      this.think(now, foe);
    }
    d.setRudderOrder(rudderForCourse(d, this.course));
    // Fire whenever a battery has a solution it can reach with and the plot has had a few readings; the guns hold fire
    // themselves until they are loaded and on.
    return me.batteries.map((b) => me.cfg.autoTarget?.battery !== b.setup.id && b.gunnery.canReach && b.gunnery.track.count >= 6);
  }

  private think(now: number, foe: Combatant): void {
    const me = this.me;
    const p = this.profile;
    const d = me.dynamics;
    const dx = foe.x - me.x;
    const dz = foe.z - me.z;
    const range = Math.hypot(dx, dz);
    const bearing = azimuthTo(dx, dz);

    const s = me.damage.summary();
    const condition = Math.min(s.power > 0.01 ? 1 : 0, 1) * (1 - s.floodedT / s.reserveT) * (1 - s.turretsLost / Math.max(s.turretsTotal, 1)) * s.morale;
    if (p.withdrawBelow > 0 && condition < p.withdrawBelow) this.state = 'withdraw';
    else if (this.state === 'withdraw' && condition > p.withdrawBelow + 0.2) this.state = 'engage';
    else if (this.state !== 'withdraw') this.state = range > p.rangeMax ? 'approach' : 'engage';

    let course: number;
    switch (this.state) {
      case 'withdraw':
        course = bearing + Math.PI;
        d.setTelegraph(p.approachTelegraph);
        break;
      case 'approach':
        course = bearing + this.side * p.approachAngle * DEG;
        d.setTelegraph(p.approachTelegraph);
        break;
      default: {
        // Fight on a course that keeps his broadside to the enemy: roughly parallel when in the band, turning away if too close
        // and in if too far.
        const parallel = bearing + this.side * 90 * DEG;
        if (range < p.rangeMin) course = bearing + this.side * 125 * DEG;
        else if (range > p.rangeMax * 0.92) course = bearing + this.side * 65 * DEG;
        else course = parallel;
        d.setTelegraph(range < p.rangeMin ? p.approachTelegraph : p.engageTelegraph);
        break;
      }
    }
    if (p.jinkDeg > 0 && this.state === 'engage') {
      if (now >= this.nextJink) {
        this.jinkSign = -this.jinkSign;
        this.nextJink = now + p.jinkPeriod * (0.6 + 0.8 * this.rng.next());
      }
      course += this.jinkSign * p.jinkDeg * DEG;
    }
    this.course = ((course % TWO_PI) + TWO_PI) % TWO_PI;
  }
}
