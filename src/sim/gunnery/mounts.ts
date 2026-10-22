import { deckHeightAtX } from '../../render/ships/forge/hull';
import type { ShipModel, ShipSpec } from '../../render/ships/forge/spec';
import type { TurretMount } from './battery';

const DEG = Math.PI / 180;

/** The turret mounts of a built ship model: the same positions and arcs the renderer draws. */
export function mountsFromModel(model: ShipModel): TurretMount[] {
  return model.turrets.map((t) => ({
    id: t.id,
    axis: t.axis,
    trunnions: t.trunnions,
    barrelLength: t.muzzleOffset[0],
    restTrainRad: t.restTrainDeg * DEG,
    trainMinRad: t.trainMinDeg * DEG,
    trainMaxRad: t.trainMaxDeg * DEG,
  }));
}

/**
 * The same mounts computed from the declarative ship spec alone, with no mesh built. The Forge places a turret's barrels
 * from these same numbers, which a test confirms, so the headless duel and the rendered game agree on where shells start.
 */
export function mountsFromSpec(spec: ShipSpec): TurretMount[] {
  return spec.turrets.map((t) => {
    const deckY = deckHeightAtX(spec.hull, t.x);
    const topY = deckY + t.barbetteHeight;
    return {
      id: t.id,
      axis: [t.x, deckY, t.z] as const,
      trunnions: Array.from({ length: t.guns }, (_, g) => [t.x + 1.0, topY + t.house.height * 0.42, t.z + (g - (t.guns - 1) / 2) * t.gunSpacing] as const),
      barrelLength: t.barrelLength,
      restTrainRad: t.restTrainDeg * DEG,
      trainMinRad: (t.trainArcDeg?.[0] ?? -180) * DEG,
      trainMaxRad: (t.trainArcDeg?.[1] ?? 180) * DEG,
    };
  });
}
