import type { ShipSpec } from '../../render/ships/forge/spec';
import type { Wounds } from '../damage/ship-damage';
import type { DamageSpec } from '../damage/spec';
import type { PlotTiming } from '../gunnery/gunnery';
import type { RangefinderSpec } from '../gunnery/rangefinder';
import type { HandlingOverrides } from '../ships/dynamics';
import type { TorpedoSpec, TubeSpec } from '../torpedo/spec';
import type { BatterySetup, Skill } from './combatant';

/** Everything that defines a class of fighting ship: the model, the armour, the guns and how fast she goes. */
export interface ShipSetup {
  name: string;
  ship: ShipSpec;
  damage: DamageSpec;
  batteries: BatterySetup[];
  maxSpeedKn: number;
  /** How she handles, where her class differs from the reference battleship (the Dreadnought). */
  handling?: HandlingOverrides;
  rangefinder: RangefinderSpec;
  skill?: Skill;
  /** Torpedo tubes and the torpedo they fire. */
  tubes?: TubeSpec[];
  torpedo?: TorpedoSpec;
  /** A small, fast ship: the other side's anti-destroyer guns pick her as a target by themselves. */
  small?: boolean;
  /** A battery that chooses its own targets (the 12-pounders): which one, how far out it will engage small craft, and, if its guns can hurt a capital ship, how far out it will engage one. */
  autoTarget?: { battery: string; maxRange: number; capitalRange?: number };
  /** Where the gunnery director's eye is, ship space (x forward, y up). Default: the Dreadnought's foretop. */
  director?: readonly [number, number, number];
  /** Turrets whose mechanism is prone to jam when they fire: the chance a salvo jams one, and how long the crew take to clear it. */
  jams?: { turretIds: readonly string[]; chance: number; seconds: number };
  /** Damage she brings into the fight. */
  wounds?: Wounds;
  /** The rudder angle her jammed steering holds, -1..1, when `wounds.steering` is set. */
  rudderJam?: number;
  /** She will never haul down her colours. */
  neverStrikes?: boolean;
  /** How fast her plotting table works, where it is not the real one's pace (see pace.ts). */
  plot?: PlotTiming;
}
