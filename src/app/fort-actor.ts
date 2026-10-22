import { fortShipSpec } from '../data/forts/fort-model';
import type { SeaRenderer } from '../render/sea-renderer';
import { buildShip } from '../render/ships/forge/build-ship';
import type { ShipModel } from '../render/ships/forge/spec';
import type { ShipInstance } from '../render/ships/ship-renderer';
import type { Fort } from '../sim/fort/fort';

/** Concrete and earth, in the ship shader's terms. */
const CONCRETE: [number, number, number] = [0.3, 0.29, 0.26];
const CONCRETE_LIGHT: [number, number, number] = [0.36, 0.345, 0.31];

/**
 * A fort in the picture: the works built from a Forge model, standing on the ground, with each gun layed on the target by the
 * fort's own gunnery. A wrecked gun sags to its stops and smokes.
 */
export class FortActor {
  readonly instance: ShipInstance;
  readonly model: ShipModel;
  private readonly turretIds: string[];

  constructor(
    sea: SeaRenderer,
    readonly fort: Fort,
  ) {
    this.model = buildShip(fortShipSpec(fort.spec));
    this.instance = sea.addShip(this.model);
    this.instance.paint = { hull: CONCRETE, superstructure: CONCRETE_LIGHT, wetness: 0, concrete: true };
    // The apron's deck is a little above the ground; the hull below it is buried.
    this.instance.pose = { x: fort.x, z: fort.z, headingDeg: 0, heave: fort.base - 0.1, pitch: 0, roll: 0 };
    this.turretIds = this.model.turrets.map((t) => t.id);
  }

  /** Lay the barrels on the fort's gunnery. */
  updateRender(): void {
    const battery = this.fort.gunnery.battery;
    battery.turrets.forEach((t, i) => {
      const ref = this.model.turrets.find((r) => r.id === t.mount.id);
      if (!ref) return;
      const wrecked = this.fort.emplacements[i]?.state === 'wrecked';
      // A wrecked gun droops to the top of its elevation, pointing at the sky.
      this.instance.rig.setTurret(ref.id, t.train, wrecked ? ref.maxElevDeg * (Math.PI / 180) : t.elev);
      ref.barrelNodes.forEach((_, g) => this.instance.rig.setRecoil(ref.id, g, battery.recoil(i, g)));
    });
    void this.turretIds;
  }
}
