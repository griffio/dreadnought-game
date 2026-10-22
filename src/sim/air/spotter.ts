import type { Contact, AerialObserver } from '../gunnery/gunnery';
import type { Terrain } from '../terrain/terrain';

export type SpotterState = 'deck' | 'launching' | 'flying' | 'landing';

export const SPOTTER = {
  /** Cruising speed, m/s, altitude, m, and the radius of its orbit about what it is watching, m. */
  speed: 38,
  altitude: 800,
  orbitRadius: 1300,
  /** How far it can make out a ship or a gun, horizontally, metres, in clear air. */
  viewRange: 7000,
  /** Seconds to be hoisted out and get airborne, and to alight and be hoisted in. */
  launchSeconds: 25,
  landSeconds: 30,
  /** Seconds of fuel; and the wait before it can go up again. */
  endurance: 1500,
  turnRate: 0.4,
  /** How far below it a mine can be made out, metres. */
  mineRadius: 700,
};

export interface SpotterHost {
  /** Where the carrying ship is, for the launch and the landing. */
  ship(): { x: number; z: number };
}

/**
 * The spotter aircraft: a floatplane carried aboard, put over the side and flown out to orbit above the target. From
 * eight hundred metres it sees over any headland, so it can range a target the ship cannot see and call the fall of shot, and
 * it spots mines in the water below it. It does the flying itself: the player's orders are only `launch`, `recall` and where to
 * look.
 */
export class SpotterPlane implements AerialObserver {
  state: SpotterState = 'deck';
  x = 0;
  z = 0;
  /** Compass heading, radians. */
  heading = 0;
  /** Fuel left, seconds. */
  fuel: number = SPOTTER.endurance;
  private timer = 0;
  /** The point it is told to orbit. */
  private anchor: { x: number; z: number } | null = null;
  private cooldown = 0;
  private recalled = false;
  onReveal?: (count: number) => void;

  constructor(
    private readonly host: SpotterHost,
    private readonly terrain: Terrain | null,
    private readonly mineRevealer: ((x: number, z: number, radius: number) => number) | null = null,
    private readonly visibilityKm: () => number = () => 40,
  ) {}

  get flying(): boolean {
    return this.state === 'flying';
  }

  /** The aircraft may be put up: she is on deck and has had time since the last landing. */
  get ready(): boolean {
    return this.state === 'deck' && this.cooldown <= 0;
  }

  launch(): boolean {
    if (!this.ready) return false;
    const s = this.host.ship();
    this.state = 'launching';
    this.timer = SPOTTER.launchSeconds;
    this.x = s.x;
    this.z = s.z;
    this.recalled = false;
    return true;
  }

  recall(): void {
    if (this.state === 'flying' || this.state === 'launching') this.recalled = true;
  }

  /** Tell it where to look: it orbits this point. */
  watch(x: number, z: number): void {
    this.anchor = { x, z };
  }

  position(): { x: number; z: number; altitude: number } | null {
    return this.state === 'flying' ? { x: this.x, z: this.z, altitude: SPOTTER.altitude } : null;
  }

  sees(c: Contact): boolean {
    if (this.state !== 'flying') return false;
    const d = Math.hypot(c.x - this.x, c.z - this.z);
    if (d > Math.min(SPOTTER.viewRange, this.visibilityKm() * 1000 * 0.5)) return false;
    if (this.terrain && this.terrain.blocked(this.x, SPOTTER.altitude, this.z, c.x, c.topHeight, c.z)) return false;
    return true;
  }

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
    const ship = this.host.ship();
    switch (this.state) {
      case 'deck':
        break;
      case 'launching':
        this.timer -= dt;
        this.x = ship.x;
        this.z = ship.z;
        if (this.timer <= 0) {
          this.state = 'flying';
          this.fuel = SPOTTER.endurance;
        }
        break;
      case 'flying': {
        this.fuel -= dt;
        // Fly to the orbit about the anchor, or about the ship if it has nothing to watch.
        const a = this.anchor ?? ship;
        const home = this.recalled || this.fuel <= 0;
        const target = home ? ship : a;
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const d = Math.hypot(dx, dz);
        let want: number;
        if (home) want = Math.atan2(dx, -dz);
        else if (d > SPOTTER.orbitRadius * 1.15) want = Math.atan2(dx, -dz);
        else {
          // On the orbit: steer along the tangent, a little inward, round to starboard.
          const toward = Math.atan2(dx, -dz);
          want = toward + (d > SPOTTER.orbitRadius ? 1.1 : 1.7);
        }
        let turn = want - this.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.heading += Math.min(Math.max(turn, -SPOTTER.turnRate * dt), SPOTTER.turnRate * dt);
        this.x += Math.sin(this.heading) * SPOTTER.speed * dt;
        this.z -= Math.cos(this.heading) * SPOTTER.speed * dt;
        if (this.mineRevealer) {
          const n = this.mineRevealer(this.x, this.z, SPOTTER.mineRadius);
          if (n > 0) this.onReveal?.(n);
        }
        if (home && Math.hypot(ship.x - this.x, ship.z - this.z) < 300) {
          this.state = 'landing';
          this.timer = SPOTTER.landSeconds;
        }
        break;
      }
      case 'landing':
        this.timer -= dt;
        this.x = ship.x;
        this.z = ship.z;
        if (this.timer <= 0) {
          this.state = 'deck';
          this.cooldown = 90;
        }
        break;
    }
  }
}
