import { TorpedoWorld, type TorpedoEvent } from '../torpedo/world';
import type { Combatant } from './combatant';
import { Rng } from '../rng';
import { SmokeField } from '../smoke/smoke-field';

/**
 * The shared water of a fight: every combatant and the torpedoes between them. Stepping it runs the torpedoes (the ships step
 * themselves), and tells each ship of the track of any torpedo that comes within sight.
 */
export class Arena {
  readonly torpedoes: TorpedoWorld;
  readonly ships: Combatant[] = [];
  /** The smoke on the water. */
  readonly smoke = new SmokeField();
  /** How far a torpedo's wake can be made out, metres. */
  sightRange = 2200;

  constructor(seed: number) {
    this.torpedoes = new TorpedoWorld(new Rng(seed ^ 0x70d0));
  }

  add(c: Combatant): void {
    this.ships.push(c);
  }

  step(dt: number): TorpedoEvent[] {
    this.smoke.step(dt);
    if (this.torpedoes.torpedoes.length === 0) return [];
    return this.torpedoes.step(
      dt,
      this.ships.map((c) => c.torpedoTarget),
      this.ships.filter((c) => c.damage.floating).map((c) => ({ id: c.id, x: c.x, z: c.z })),
      this.sightRange,
    );
  }
}
