import type { ShellSpec } from './ballistics';
import type { GunSpec } from './guns';

/**
 * The two rounds a big gun can fire. Armour-piercing is the gun's own shell in its data file: a hardened, capped body with a
 * small charge and a base fuze that works only after the shell is through a plate, which is what gets it into a ship's vitals.
 * High-explosive is the same shell as far as the air is concerned (the same weight, speed and drag, so the same firing table and
 * the same fall of shot), but thin-walled, filled with more than twice the explosive and fuzed to burst on whatever it meets:
 * it wrecks upperworks, funnels, boats, casemates, crews and guns in the open, and sets fires, but it breaks up on real armour.
 */
export type ShellKind = 'ap' | 'he';

/** The bursting charge of a high-explosive shell, as a fraction of its weight, against the 5% of the armour-piercing default. */
export const HE_FILLER_FRACTION = 0.11;
/** What a thin-walled high-explosive body can defeat of armour, against an armour-piercing shell of the same weight and speed. */
export const HE_ARMOUR = 0.3;

export function shellKind(spec: ShellSpec): ShellKind {
  return spec.kind ?? (spec.fuze === 'impact' ? 'he' : 'ap');
}

const variants = new WeakMap<ShellSpec, ShellSpec>();

/** The high-explosive version of a shell: the same flight, a different filling and fuze. The same object each time for the same shell. */
export function heShell(ap: ShellSpec): ShellSpec {
  let he = variants.get(ap);
  if (!he) {
    he = {
      ...ap,
      kind: 'he',
      fuze: 'impact',
      fillerKg: Math.max(ap.fillerKg ?? ap.massKg * 0.05, ap.massKg * HE_FILLER_FRACTION),
      armour: HE_ARMOUR,
    };
    variants.set(ap, he);
  }
  return he;
}

/**
 * Has this gun a choice of rounds? A heavy gun that fires the armour-piercing shell does. A light quick-firing gun's one shell is
 * already an impact-fuzed common round, and a howitzer fires only its plunging shell.
 */
export function hasShellChoice(gun: GunSpec): boolean {
  return gun.shell.fuze !== 'impact' && gun.highAngle !== true;
}

/** The shell a gun fires when the given kind is loaded (its own shell if it has no choice). */
export function shellOf(gun: GunSpec, kind: ShellKind): ShellSpec {
  return kind === 'he' && hasShellChoice(gun) ? heShell(gun.shell) : gun.shell;
}
