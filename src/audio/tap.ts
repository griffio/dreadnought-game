import { RECORDED_EFFECTS, type EffectName } from '../app/replay';

/** What the tap wraps: any object with the spectacle methods (the same set the replay records). */
type Spectacle = Record<EffectName, (...args: never[]) => unknown>;

/**
 * Hear what is drawn. Each spectacle method is wrapped so that `heard` is told of the call, and then it is carried out as before.
 * Install it after the replay recorder: a replay makes its calls through the same methods, so a replayed broadside is heard as well
 * as seen, and one wrapped call that makes another (a torpedo's blast draws a splash and a burst) is heard in both.
 */
export function tapEffects(target: Spectacle, heard: (name: EffectName, args: readonly unknown[]) => void): void {
  const methods = target as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of RECORDED_EFFECTS) {
    const inner = methods[name]!.bind(target);
    methods[name] = (...args: unknown[]) => {
      try {
        heard(name, args);
      } catch {
        /* a sound that cannot be made must not stop the picture */
      }
      return inner(...args);
    };
  }
}
