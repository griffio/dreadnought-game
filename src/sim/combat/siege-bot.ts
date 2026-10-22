import { azimuthTo } from '../gunnery/fire-control';
import { SPOTTER } from '../air/spotter';
import { rudderForCourse } from '../ships/autopilot';
import type { Fort } from '../fort/fort';
import type { Siege } from './siege';

/** How the bot fights the forts. */
export type SiegePlan = 'run' | 'bombard';

/**
 * A stand-in for the player in the headless sieges: it steams a fixed route through the water (the swept lanes, round the
 * shoals), puts the spotter aircraft up, and fires the main battery at the nearest fort it can range, by sight or from the air.
 */
export class SiegeBot {
  private leg = 0;
  private nextThink = 0;

  constructor(
    private readonly siege: Siege,
    private readonly route: readonly (readonly [number, number])[],
    private readonly plan: SiegePlan = 'bombard',
    private readonly useSpotter = true,
    /** In a bombardment she stops this far from the fort she is engaging, metres: one range for all, or one for each by id. */
    private readonly standoff: number | Record<string, number> = 7500,
  ) {}

  update(now: number): boolean[] {
    const s = this.siege;
    const me = s.player;
    const idle = me.batteries.map(() => false);
    if (!me.damage.floating) return idle;
    const d = s.dyn;

    // Steer for the next point on the route.
    const wp = this.route[Math.min(this.leg, this.route.length - 1)]!;
    if (Math.hypot(wp[0] - d.x, wp[1] - d.z) < 350 && this.leg < this.route.length - 1) this.leg++;
    let course = azimuthTo(wp[0] - d.x, wp[1] - d.z);
    // A bombardment lies at her standoff from the fort she is firing on, broadside on so that most of the turrets bear, drifting
    // slowly along the line so as to keep steerage way.
    if (this.plan === 'bombard') {
      const t = me.main.target;
      const range = t ? Math.hypot(t.x - d.x, t.z - d.z) : Number.POSITIVE_INFINITY;
      const wanted = typeof this.standoff === 'number' ? this.standoff : ((t as Fort | null)?.spec.id ? (this.standoff[(t as Fort).spec.id] ?? 7500) : 7500);
      const engaged = t !== null && range <= wanted && !(t as Fort | null)?.silenced;
      if (engaged) course = azimuthTo(t.x - d.x, t.z - d.z) + (75 * Math.PI) / 180;
      d.setTelegraph(engaged ? 1 : 2);
    }
    d.setRudderOrder(rudderForCourse(d, course));

    if (now >= this.nextThink) {
      this.nextThink = now + 1;
      this.think(now);
    }
    const g = me.main;
    const t = g.target;
    const st = t ? g.status(me.cfg.frame()) : null;
    const sighted = st?.target ? st.target.visible || st.target.spotted : false;
    const fire = !!t && g.canReach && g.track.count >= 6 && sighted && !t.struck;
    return me.batteries.map((_, i) => (i === 0 ? fire : false));
  }

  private think(now: number): void {
    const s = this.siege;
    const me = s.player;
    const g = me.main;
    const pos = { x: me.x, z: me.z };

    // Put the aircraft up early, and tell it what to look at.
    if (this.useSpotter && s.plane.ready && now > 20) s.plane.launch();

    // The fort to engage: the nearest known one within the guns' reach that is not silenced.
    const reach = g.cfgMaxRange() * 0.92;
    let best: Fort | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const f of s.forts) {
      if (f.silenced) continue;
      const d = Math.hypot(f.x - pos.x, f.z - pos.z);
      // A hidden battery is known to the plane when it can see it, or once its flash has been seen.
      const known = f.revealed(now) || s.plane.sees(f);
      if (!known || d > reach) continue;
      if (d < bestD) {
        best = f;
        bestD = d;
      }
    }
    if (best && g.target !== best) g.designate(best);
    if (!best && g.target) g.designate(null);
    g.autoSpot = true;
    const watching = best ?? s.forts.find((f) => !f.silenced) ?? null;
    if (watching) s.plane.watch(watching.x, watching.z);
    void SPOTTER;
  }
}
