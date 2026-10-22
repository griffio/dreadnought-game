import { azimuthTo } from '../gunnery/fire-control';
import { rudderForCourse } from '../ships/autopilot';
import { TELEGRAPH } from '../ships/dynamics';
import type { TorpedoWorld } from '../torpedo/world';
import type { Combatant } from './combatant';

const TWO_PI = Math.PI * 2;

/** How the bot handles torpedoes it has seen coming. */
export type Evasion = 'none' | 'head-on';

/**
 * A stand-in for the player in the headless fights: it keeps a steady course at a steady speed, points the main battery at the
 * nearest enemy, and, if told to, turns toward the track of any torpedo it has sighted (presenting the narrowest target and
 * comb-ing the fan), which is what a captain who has seen the wakes would do.
 */
export class PlayerBot {
  private course: number;
  private nextThink = 0;
  evading = false;

  constructor(
    private readonly me: Combatant,
    private readonly hostiles: () => Combatant[],
    private readonly torpedoes: TorpedoWorld,
    private readonly evasion: Evasion,
    private readonly telegraph: number = TELEGRAPH.HALF_AHEAD,
  ) {
    this.course = me.dynamics.heading;
    me.dynamics.setTelegraph(telegraph);
  }

  update(now: number): boolean[] {
    const me = this.me;
    const idle = me.batteries.map(() => false);
    if (!me.damage.floating) return idle;
    if (now >= this.nextThink) {
      this.nextThink = now + 1;
      this.think();
    }
    me.dynamics.setRudderOrder(rudderForCourse(me.dynamics, this.course));
    // The main battery fires whenever it has a plot on its target; the self-directing guns look after themselves.
    return me.batteries.map((b, i) => (i === 0 ? b.gunnery.canReach && b.gunnery.track.count >= 6 : false));
  }

  private think(): void {
    const me = this.me;
    // Main battery: the nearest enemy that is still afloat.
    const foes = this.hostiles().filter((c) => c.alive && c.damage.status !== 'struck');
    foes.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const g = me.main;
    if (foes[0] && g.target !== foes[0]) g.designate(foes[0]);
    g.autoSpot = true;

    this.evading = false;
    if (this.evasion === 'none') return;
    // The nearest sighted torpedo that is running our way.
    let worst: { range: number; bearing: number } | null = null;
    for (const t of this.torpedoes.torpedoes) {
      if (t.shooter === me.id || !t.seenBy.includes(me.id)) continue;
      const dx = me.x - t.x;
      const dz = me.z - t.z;
      const range = Math.hypot(dx, dz);
      const toUs = azimuthTo(dx, dz);
      let off = t.heading - toUs;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      // It is a threat if its track passes close to us.
      if (Math.abs(Math.sin(off)) * range > 250 + me.halfBeam + 100) continue;
      if (worst === null || range < worst.range) worst = { range, bearing: azimuthTo(t.x - me.x, t.z - me.z) };
    }
    if (worst) {
      this.evading = true;
      me.dynamics.setTelegraph(TELEGRAPH.FULL_AHEAD);
      this.course = worst.bearing;
    } else {
      me.dynamics.setTelegraph(this.telegraph);
    }
    this.course = ((this.course % TWO_PI) + TWO_PI) % TWO_PI;
  }
}
