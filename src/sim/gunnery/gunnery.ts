import type { Rng } from '../rng';
import { shipPointToWorld, type ShipFrame } from '../ships/frame';
import type { Terrain } from '../terrain/terrain';
import { CALM, rangeAtElevation, solveElevation, type Environment, type ShellSpec } from './ballistics';
import { shellOf, hasShellChoice, type ShellKind } from './shells';
import { GunBattery, type MuzzleShot, type SalvoStart, type TurretMount, type TurretStatus } from './battery';
import { azimuthTo, chargeFor, PLUNGE_MIN, solveFiring, type FireSolution, type OwnState } from './fire-control';
import type { GunSpec } from './guns';
import { measureRange, newRangefinderBias, type RangefinderSpec } from './rangefinder';
import { ShellWorld, type DiveInfo, type HitBox, type ImpactInfo, type ImpactResolution, type ShellEvent } from './shell-world';
import type { DispersionSpec } from './dispersion';
import { AutoSpotter, fallRelativeToTarget, reportSalvo, type SalvoReport, type ShellFall } from './spotting';
import { TargetTrack } from './target-track';

const DEG = Math.PI / 180;

/** Where the guns are laid on a contact: her aim point if she has one, else her middle. */
const aimX = (c: Contact): number => c.aimX ?? c.x;
const aimZ = (c: Contact): number => c.aimZ ?? c.z;

/** Something the gunnery officer can designate and shoot at. Fields are read live each step. */
export interface Contact {
  id: number;
  name: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Compass heading, radians. */
  heading: number;
  halfLength: number;
  halfBeam: number;
  draft: number;
  height: number;
  /** Highest point above the sea, metres (decides when it comes over the horizon). */
  topHeight: number;
  /** Height of the deck, metres (decides when the hull is down). */
  deckHeight: number;
  /** False once the ship is gone: she is no longer a target. */
  alive?: boolean;
  /** A small, fast craft: anti-destroyer guns pick her out for themselves. */
  small?: boolean;
  /** She has struck her colours: no gun is to be fired at her. */
  struck?: boolean;
  /** Height of the ground she stands on above the sea, metres: a fort on a hill. 0 for a ship. */
  baseHeight?: number;
  /**
   * Where the guns are to be laid, when that is not her middle: a fort has several positions, and the aim is at the first that
   * still fires. Defaults to x, z. `aimEpoch` counts the times the aim point has jumped, so that the plot is begun again.
   */
  aimX?: number;
  aimZ?: number;
  aimEpoch?: number;
  /** Fine resolution of a shell reaching the hit box (see HitBox). */
  resolveHit?: (info: ImpactInfo) => ImpactResolution | null;
  resolveDive?: (info: DiveInfo) => ImpactResolution | null;
}

/**
 * An eye in the air: a spotter aircraft. When the ship cannot see a target (it is behind a headland, or hull-down) the
 * aircraft can, and its sightings take the place of the rangefinder's, and its eye calls the fall of shot.
 */
export interface AerialObserver {
  /** Where the aircraft is now, or null when it is not flying. */
  position(): { x: number; z: number; altitude: number } | null;
  /** Can it see the contact (the line of sight from the air is clear, and she is in its view)? */
  sees(c: Contact): boolean;
}

export type TrackQuality = 'none' | 'lost' | 'plotting' | 'settling' | 'settled' | 'turned';

/**
 * How fast the plotting table works: seconds between rangings, how long the plot remembers and how heavily it weights the recent
 * fixes, how much error it assumes in one fix (metres), and how long a plot must be before it says anything about speed.
 */
export interface PlotTiming {
  rangingPeriod: number;
  window: number;
  tau: number;
  positionSigma: number;
  minSpan: number;
}

export const REAL_PLOT: PlotTiming = { rangingPeriod: 2, window: 75, tau: 40, positionSigma: 40, minSpan: 6 };

export interface GunneryConfig {
  gun: GunSpec;
  mounts: readonly TurretMount[];
  rng: Rng;
  /** The id this ship's shells carry, so they cannot hit their own firer. */
  shooterId: number;
  /** The real wind and Coriolis. */
  env: Environment;
  /** What the fire-control table believes about them (default: nothing). */
  assumed?: Environment;
  rangefinder: RangefinderSpec;
  /** Scatter of the guns; a poorly trained or worn battery has more of it. */
  dispersion?: DispersionSpec;
  visibilityKm: number;
  /** Height of the director's eye above the waterline, metres. */
  directorHeight: number;
  /** Seconds between new firing solutions (a ship's table is slower than a player at the controls wants). Default 0.2. */
  solvePeriod?: number;
  /** How fast the table plots (default: REAL_PLOT). */
  plot?: PlotTiming;
}

export interface GunneryStatus {
  target: {
    id: number;
    name: string;
    range: number;
    bearingDeg: number;
    relativeBearingDeg: number;
    visible: boolean;
    hullDown: boolean;
    /** How much of the view of her comes through any smoke between, 0..1. */
    clarity: number;
    /** The ship cannot see her but the spotter aircraft can: her fix comes from the air. */
    spotted: boolean;
  } | null;
  quality: TrackQuality;
  estimate: { speedKn: number; courseDeg: number } | null;
  solution: FireSolution | null;
  corrections: { range: number; deflection: number };
  autoSpot: boolean;
  turrets: TurretStatus[];
  bearingGuns: number;
  armed: boolean;
  shellsInFlight: number;
  /** Seconds until the next splash is due, from the oldest shell in the air; null when none. */
  nextSplashIn: number | null;
  lastReport: SalvoReport | null;
  reportAge: number;
  /** The round loaded for the next salvo, and whether the guns have a choice of rounds at all. */
  shell: ShellKind;
  shellChoice: boolean;
}

interface SalvoTrack {
  id: number;
  expected: number;
  resolved: number;
  targetId: number | null;
  falls: ShellFall[];
  started: number;
  /** The corrections (range, deflection) the guns were laid with when it was fired. */
  firedWith: { range: number; deflection: number };
}

/** Below this much of the view coming through, the target cannot be ranged at all. */
const MIN_CLARITY = 0.12;
/** How long a line-of-sight test through the land is trusted, seconds. */
const TERRAIN_VIEW_SECONDS = 0.25;
/** An aircraft's sightings: a fixed error in its reckoning of its own position (a fraction of the range), then metres and radians of noise. */
const AIR_BIAS = 0.01;
const AIR_RANGE_SIGMA = 14;
const AIR_RANGE_FRACTION = 0.012;
const AIR_BEARING_SIGMA = 0.0016;
const SOLVE_PERIOD = 0.2;
const BEARING_SIGMA = 0.0006;
const RANGE_STEP = 100;
const DEFLECTION_STEP = 10;
const ARM_EXPIRY_SECONDS = 45;
/** Seconds without a sighting before the plot is called lost. */
const LOST_AFTER = 12;
const TURN_REPLOT_KEEP = 18;
const TURN_DISPLAY_SECONDS = 24;
/** Horizon distance per square-root metre of height, metres: 3.57 km with standard refraction. */
const HORIZON_PER_SQRT_M = 3570;

const horizon = (heightM: number): number => HORIZON_PER_SQRT_M * Math.sqrt(Math.max(heightM, 0));

/**
 * The gunnery department: the battery, the shells it has in the air, and the fire-control chain that aims it.
 * A designated contact is ranged every couple of seconds, plotted by the tracker, solved with the real ballistics and
 * the turrets slewed to the answer. Splashes are called back to the corrector (the player, or the auto-spotter).
 */
export class Gunnery {
  readonly battery: GunBattery;
  readonly world: ShellWorld;
  readonly track: TargetTrack;
  readonly spotter = new AutoSpotter();
  readonly manual = { range: 0, deflection: 0 };
  readonly contacts: Contact[] = [];
  /** Which contacts the player may pick by cycling: a battery he has not found is not on the list. */
  selectable: ((c: Contact) => boolean) | null = null;
  autoSpot = false;
  visibilityKm: number;
  /** A spotter aircraft that sees what the ship cannot, if one is up. */
  aerial: AerialObserver | null = null;
  /**
   * Where the eye is, when it is not at the guns: a fort's observation post on the ridge, from which the strait can be seen
   * while the guns, behind the hill, cannot see it. `y` is the eye's height above the sea.
   */
  observer: { x: number; z: number; y: number } | null = null;
  /** How much of the view comes through between two points, 0..1: smoke between the ships shuts the rangefinder's eye. */
  occlusion: ((fromX: number, fromZ: number, toX: number, toZ: number) => number) | null = null;
  /** How well the fire control is working, 0..1: damage to the directors and rangefinders spoils the ranging. */
  fireControlHealth = 1;

  onShot?: (shot: MuzzleShot) => void;
  onShellEvent?: (event: ShellEvent) => void;
  onReport?: (report: SalvoReport) => void;

  private designated: Contact | null = null;
  private solution: FireSolution | null = null;
  private manualAim: { azimuth: number; elevation: number } | null = null;
  private rangefinderBias = 0;
  private rfTimer = 0;
  private solveTimer = 0;
  private lastSighting = Number.NEGATIVE_INFINITY;
  private turnedUntil = Number.NEGATIVE_INFINITY;
  private lateralMisses = 0;
  private prevEstimate: { t: number; x: number; z: number; vx: number; vz: number } | null = null;
  private triggerPrev = false;
  /** Cease fire stands the guns down until the trigger has been released. */
  private ceased = false;
  private armedAt: number | null = null;
  private readonly salvos = new Map<number, SalvoTrack>();
  private lastReport: SalvoReport | null = null;
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private readonly muzzleHeight: number;
  private now = 0;
  private groundTerrain: Terrain | null = null;
  /** The shell as loaded for the present target: a howitzer's charge is chosen by range. */
  private activeShell: ShellSpec;
  /** The round the player has loaded for the next salvo. */
  private selected: ShellKind = 'ap';
  /** The shell each salvo in flight was fired with: the choice is made when the salvo is begun, not as each barrel fires. */
  private readonly salvoShell = new Map<number, ShellSpec>();
  private airBias = 0;
  private aimEpoch = 0;
  private terrainView = { id: -1, at: Number.NEGATIVE_INFINITY, top: false, deck: false };

  private readonly rangingPeriod: number;
  private readonly plotting: PlotTiming;

  constructor(private readonly cfg: GunneryConfig) {
    const plot = cfg.plot ?? REAL_PLOT;
    this.plotting = plot;
    this.rangingPeriod = plot.rangingPeriod;
    this.track = new TargetTrack(plot.window, plot.tau, plot.positionSigma, plot.minSpan);
    this.battery = new GunBattery(cfg.mounts, cfg.gun, cfg.rng, cfg.dispersion);
    this.world = new ShellWorld(cfg.env);
    this.activeShell = cfg.gun.shell;
    this.visibilityKm = cfg.visibilityKm;
    const ys = cfg.mounts.flatMap((m) => m.trunnions.map((t) => t[1]));
    this.muzzleHeight = ys.reduce((a, b) => a + b, 0) / Math.max(ys.length, 1);
  }

  /** The land: shells strike it and it can stand between the ship and her target. */
  get terrain(): Terrain | null {
    return this.groundTerrain;
  }

  set terrain(t: Terrain | null) {
    this.groundTerrain = t;
    this.world.terrain = t;
    this.terrainView.id = -1;
  }

  // ---- orders ----------------------------------------------------------------------------------

  get target(): Contact | null {
    return this.designated;
  }

  designate(contact: Contact | null): void {
    if (contact === this.designated) return;
    this.designated = contact;
    this.track.reset();
    this.spotter.reset();
    this.manual.range = 0;
    this.manual.deflection = 0;
    this.solution = null;
    this.prevEstimate = null;
    this.lateralMisses = 0;
    this.lastSighting = Number.NEGATIVE_INFINITY;
    this.turnedUntil = Number.NEGATIVE_INFINITY;
    this.rangefinderBias = contact ? newRangefinderBias(this.cfg.rng, this.cfg.rangefinder) : 0;
    // The aircraft's navigation error is a fixed number for the engagement, drawn from the ids so that no random draw is spent on it.
    this.aimEpoch = contact?.aimEpoch ?? 0;
    this.airBias = contact ? (((Math.imul(contact.id + 1, 2654435761) ^ Math.imul(this.cfg.shooterId + 7, 40503)) >>> 0) / 4294967296 - 0.5) * 2 * AIR_BIAS : 0;
    this.terrainView.id = -1;
    this.rfTimer = this.rangingPeriod; // take the first reading straight away
    this.solveTimer = SOLVE_PERIOD;
  }

  /** Select the next (or previous) contact by range from the ship. */
  cycle(direction: 1 | -1, ship: ShipFrame): void {
    const pool = this.selectable ? this.contacts.filter((c) => this.selectable!(c)) : this.contacts;
    if (pool.length === 0) return;
    const sorted = [...pool].sort(
      (a, b) => Math.hypot(a.x - ship.x, a.z - ship.z) - Math.hypot(b.x - ship.x, b.z - ship.z),
    );
    const at = this.designated ? sorted.indexOf(this.designated) : -1;
    const next = at === -1 ? sorted[direction > 0 ? 0 : sorted.length - 1]! : sorted[(at + direction + sorted.length) % sorted.length]!;
    this.designate(next);
  }

  /** Aim the guns at a bearing and elevation by hand (no target designated). */
  setManualAim(azimuth: number, elevation: number): void {
    this.manualAim = { azimuth, elevation };
  }

  /** Apply the player's spotting corrections in steps of 100 m of range and 10 m of deflection. */
  correct(rangeSteps: number, deflectionSteps: number): void {
    this.manual.range += rangeSteps * RANGE_STEP;
    this.manual.deflection += deflectionSteps * DEFLECTION_STEP;
    this.solveTimer = SOLVE_PERIOD;
  }

  /** The round loaded for the next salvo (a gun with no choice always has its own). */
  get shell(): ShellKind {
    return this.selected;
  }

  /** Has this battery a choice of rounds? */
  get shellChoice(): boolean {
    return hasShellChoice(this.cfg.gun);
  }

  /** Load a kind of round: the next salvo to be begun fires it. Salvos already begun, and shells in the air, keep theirs. */
  setShell(kind: ShellKind): void {
    this.selected = this.shellChoice ? kind : 'ap';
    // The two rounds fly alike, so the firing solution does not change; a howitzer's charge is its own business.
    if (!this.cfg.gun.highAngle) this.activeShell = shellOf(this.cfg.gun, this.selected);
  }

  toggleAutoSpot(): boolean {
    this.autoSpot = !this.autoSpot;
    return this.autoSpot;
  }

  ceaseFire(): void {
    this.armedAt = null;
    this.ceased = true;
  }

  /** Seconds since the target was last ranged, by the ship's eye or the aircraft's. */
  fixAge(now: number): number {
    return now - this.lastSighting;
  }

  /** Corrections in force: the corrector's plus the player's own. */
  get corrections(): { range: number; deflection: number } {
    return { range: this.spotter.range + this.manual.range, deflection: this.spotter.deflection + this.manual.deflection };
  }

  // ---- the step --------------------------------------------------------------------------------

  /**
   * Advance by `dt` at simulation time `now`. `trigger` is the fire control held down; its rising edge arms a salvo that
   * goes as soon as the guns are ready, and holding it keeps salvos coming until released or ceased.
   */
  update(dt: number, now: number, ship: ShipFrame, trigger: boolean): ShellEvent[] {
    this.now = now;
    if (!trigger) this.ceased = false;
    trigger = trigger && !this.ceased;
    if (trigger && !this.triggerPrev) this.armedAt = now;
    this.triggerPrev = trigger;
    if (this.armedAt !== null && now - this.armedAt > ARM_EXPIRY_SECONDS && !trigger) this.armedAt = null;

    this.fireControl(dt, now, ship);

    const shots = this.battery.update(dt, ship, trigger || this.armedAt !== null);
    for (const started of this.battery.drainStartedSalvos()) this.beginSalvo(started, now);
    if (shots.length > 0) this.armedAt = null;
    for (const shot of shots) {
      this.world.spawn(shot, this.salvoShell.get(shot.salvo) ?? this.activeShell, this.cfg.shooterId);
      this.onShot?.(shot);
    }

    const boxes = this.contacts.filter((c) => c.alive !== false).map<HitBox>((c) => ({
      id: c.id,
      x: c.x,
      z: c.z,
      heading: c.heading,
      halfLength: c.halfLength,
      halfBeam: c.halfBeam,
      draft: c.draft,
      height: c.height,
      resolve: c.resolveHit ? (info) => c.resolveHit!(info) : undefined,
      resolveDive: c.resolveDive ? (info) => c.resolveDive!(info) : undefined,
    }));
    const events = this.world.step(dt, boxes);
    for (const e of events) {
      this.resolve(e, ship);
      this.onShellEvent?.(e);
    }
    return events;
  }

  private beginSalvo(s: SalvoStart, now: number): void {
    this.salvoShell.set(s.id, this.activeShell);
    if (this.salvoShell.size > 64) this.salvoShell.delete(this.salvoShell.keys().next().value!);
    this.salvos.set(s.id, {
      id: s.id,
      expected: s.shells,
      resolved: 0,
      targetId: this.designated?.id ?? null,
      falls: [],
      started: now,
      firedWith: this.corrections,
    });
  }

  private resolve(e: ShellEvent, ship: ShipFrame): void {
    const salvo = this.salvos.get(e.shell.salvo);
    if (!salvo) return;
    salvo.resolved++;
    const contact = salvo.targetId === null ? null : this.contacts.find((c) => c.id === salvo.targetId);
    // A fall can only be called if somebody could see it: the ship, or the aircraft overhead.
    if (contact && this.observes(ship, contact)) {
      const hit = (e.kind === 'hit' && e.targetId === contact.id) || (e.kind === 'splash' && e.diveHit?.targetId === contact.id);
      const origin = this.aerial?.position() && !this.isVisible(ship, contact).visible ? this.aerial.position()! : ship;
      salvo.falls.push(fallRelativeToTarget(origin.x, origin.z, aimX(contact), aimZ(contact), e.x, e.z, hit));
    }
    if (salvo.resolved >= salvo.expected) this.finish(salvo);
  }

  private finish(salvo: SalvoTrack): void {
    this.salvos.delete(salvo.id);
    this.salvoShell.delete(salvo.id);
    if (salvo.falls.length === 0) return;
    const report = reportSalvo(salvo.id, salvo.falls);
    this.lastReport = report;
    this.lastReportAt = this.now;
    if (this.autoSpot) this.spotter.apply(report, salvo.firedWith, this.manual);
    this.solveTimer = SOLVE_PERIOD;
    this.onReport?.(report);
  }

  // ---- fire control ----------------------------------------------------------------------------

  /** Does land stand in the way of the line from the ship's eye to the contact's top, and to her deck? Trusted for a quarter of a second. */
  private landView(ship: ShipFrame, c: Contact): { top: boolean; deck: boolean } {
    const terrain = this.groundTerrain;
    if (!terrain) return { top: false, deck: false };
    const v = this.terrainView;
    if (v.id === c.id && this.now - v.at < TERRAIN_VIEW_SECONDS) return v;
    const eye = this.eyeOf(ship);
    v.id = c.id;
    v.at = this.now;
    v.top = terrain.blocked(eye.x, eye.y, eye.z, aimX(c), c.topHeight, aimZ(c));
    v.deck = v.top || terrain.blocked(eye.x, eye.y, eye.z, aimX(c), c.deckHeight, aimZ(c));
    return v;
  }

  /** Where the eye that finds the target is: the director aloft, or the observation post. */
  private eyeOf(ship: ShipFrame): { x: number; y: number; z: number } {
    return this.observer ?? { x: ship.x, y: this.cfg.directorHeight + Math.max(ship.y, 0), z: ship.z };
  }

  private isVisible(ship: ShipFrame, c: Contact): { visible: boolean; hullDown: boolean; range: number; clarity: number } {
    const eyePos = this.eyeOf(ship);
    const range = Math.hypot(aimX(c) - eyePos.x, aimZ(c) - eyePos.z);
    const eye = horizon(eyePos.y);
    const inRange = range <= this.visibilityKm * 1000;
    const clarity = this.occlusion ? this.occlusion(eyePos.x, eyePos.z, aimX(c), aimZ(c)) : 1;
    const land = this.landView(ship, c);
    return {
      visible: inRange && range <= eye + horizon(c.topHeight) && clarity >= MIN_CLARITY && !land.top,
      hullDown: range > eye + horizon(c.deckHeight) || land.deck,
      range,
      clarity,
    };
  }

  /** Can the fall of shot about this contact be seen: from the ship, or from the air? */
  private observes(ship: ShipFrame, c: Contact): boolean {
    return this.isVisible(ship, c).visible || (this.aerial?.sees(c) ?? false);
  }

  private fireControl(dt: number, now: number, ship: ShipFrame): void {
    const c = this.designated;
    if (!c) {
      if (this.manualAim) this.battery.order(this.manualAim.azimuth, this.manualAim.elevation, ship.heading);
      return;
    }
    // The aim point has moved to another position of the fort: begin the plot again, keeping the corrections.
    if ((c.aimEpoch ?? 0) !== this.aimEpoch) {
      this.aimEpoch = c.aimEpoch ?? 0;
      this.track.reset();
      this.prevEstimate = null;
      this.lateralMisses = 0;
      this.lastSighting = Number.NEGATIVE_INFINITY;
      this.solution = null;
      this.rfTimer = this.rangingPeriod;
      this.terrainView.id = -1;
    }
    const sight = this.isVisible(ship, c);

    this.rfTimer += dt;
    if (this.rfTimer >= this.rangingPeriod) {
      this.rfTimer = 0;
      if (sight.visible && this.fireControlHealth > 0.12) this.sightTarget(now, ship, c, sight.range, sight.hullDown, sight.clarity);
      else if (!sight.visible && this.fireControlHealth > 0.12) this.sightFromAir(now, c);
    }

    this.solveTimer += dt;
    if (this.solveTimer >= (this.cfg.solvePeriod ?? SOLVE_PERIOD)) {
      this.solveTimer = 0;
      this.solve(now, ship);
    }
  }

  /** The aircraft's fix on a target the ship cannot see: from where it flies, with its own errors and a navigation bias. */
  private sightFromAir(now: number, c: Contact): void {
    const air = this.aerial?.position();
    if (!air || !this.aerial!.sees(c)) return;
    const rng = this.cfg.rng;
    const range = Math.hypot(aimX(c) - air.x, aimZ(c) - air.z);
    const measured = range * (1 + this.airBias) + rng.gaussian() * (AIR_RANGE_SIGMA + AIR_RANGE_FRACTION * range);
    const bearing = azimuthTo(aimX(c) - air.x, aimZ(c) - air.z) + rng.gaussian() * AIR_BEARING_SIGMA;
    this.recordFix(now, air.x, air.z, measured, bearing);
  }

  private sightTarget(now: number, ship: ShipFrame, c: Contact, range: number, hullDown: boolean, clarity: number): void {
    const rng = this.cfg.rng;
    // A hull-down target is ranged on its upperworks, which are harder to hold: the error grows.
    // Damaged directors and rangefinders read worse, and a hull-down target is ranged on its upperworks.
    // Thin smoke between the ships blurs the image: the error grows as the view dims.
    const error = (hullDown ? 1.6 : 1) / Math.max(this.fireControlHealth, 0.3) / Math.max(clarity, 0.3);
    const spec = { ...this.cfg.rangefinder, angularError: this.cfg.rangefinder.angularError * error };
    const measured = measureRange(rng, range, spec, this.visibilityKm, this.rangefinderBias);
    const eyePos = this.eyeOf(ship);
    const trueBearing = azimuthTo(aimX(c) - eyePos.x, aimZ(c) - eyePos.z);
    const bearing = trueBearing + rng.gaussian() * BEARING_SIGMA;
    this.recordFix(now, eyePos.x, eyePos.z, measured, bearing);
  }

  /** Plot one fix: the observer's position and the range and bearing it measured. */
  private recordFix(now: number, ox: number, oz: number, measured: number, bearing: number): void {
    // Has the target turned? Its bearing is measured far more exactly than its range, so a sideways drift away from the
    // fitted track gives it away within a few readings.
    const prev = this.prevEstimate;
    if (prev && this.track.count >= 6 && this.track.span(now) >= 20) {
      const dt = now - prev.t;
      const px = prev.x + prev.vx * dt;
      const pz = prev.z + prev.vz * dt;
      const fx = ox + Math.sin(bearing) * measured;
      const fz = oz - Math.cos(bearing) * measured;
      const lx = Math.cos(bearing);
      const lz = Math.sin(bearing); // the unit vector across the line of sight
      const lateral = (fx - px) * lx + (fz - pz) * lz;
      const limit = Math.max(25, 4 * BEARING_SIGMA * measured);
      this.lateralMisses = Math.abs(lateral) > limit ? this.lateralMisses + 1 : 0;
      if (this.lateralMisses >= 2) {
        this.track.trim(now, TURN_REPLOT_KEEP);
        this.turnedUntil = now + TURN_DISPLAY_SECONDS;
        this.lateralMisses = 0;
      }
    }

    this.track.observe(now, ox, oz, measured, bearing);
    this.lastSighting = now;
    const est = this.track.estimate(now);
    this.prevEstimate = est ? { t: now, x: est.x, z: est.z, vx: est.vx, vz: est.vz } : null;
  }

  private solve(now: number, ship: ShipFrame): void {
    const est = this.track.estimate(now);
    if (!est) return;
    const gun = this.cfg.gun;
    const maxEl = gun.maxElevationDeg * DEG;
    const own: OwnState = { x: ship.x, z: ship.z, vx: ship.vx, vz: ship.vz, muzzleHeight: this.muzzleHeight + Math.max(ship.y, 0) };
    const target = { x: est.x, z: est.z, vx: est.vx, vz: est.vz, y: this.designated?.baseHeight ?? 0 };
    const assumed = this.cfg.assumed ?? CALM;
    const corr = this.corrections;
    // A howitzer takes the charge that brings the shell down on the target on a steep trajectory.
    if (gun.highAngle && gun.charges) {
      this.activeShell = chargeFor(gun.shell, gun.charges, Math.hypot(est.x - own.x, est.z - own.z), own.muzzleHeight);
    }
    const centre = solveFiring(own, target, this.activeShell, maxEl, corr, assumed, this.solution ?? undefined, { highAngle: gun.highAngle });
    this.solution = centre;

    // Each turret stands somewhere else on the ship, so each must be laid for the same aim point from where it stands
    // (parallax). The drift and lead the full solution found are the same for all of them, so each turret takes the centre's
    // answer and adjusts it by how its bearing to the aim point and its range to it differ.
    const slope = this.elevationPerMetre(centre.elevation);
    const flat: ShipFrame = { ...ship, pitch: 0, roll: 0 };
    const centreBearing = azimuthTo(centre.aimX - own.x, centre.aimZ - own.z);
    this.battery.turrets.forEach((t, i) => {
      const p = shipPointToWorld(flat, t.mount.axis);
      const dx = centre.aimX - p[0];
      const dz = centre.aimZ - p[2];
      const bearing = azimuthTo(dx, dz);
      const range = Math.hypot(dx, dz);
      let dAz = bearing - centreBearing;
      if (dAz > Math.PI) dAz -= 2 * Math.PI;
      if (dAz < -Math.PI) dAz += 2 * Math.PI;
      this.battery.orderTurret(i, centre.azimuth + dAz, centre.elevation + slope * (range - centre.range), ship.heading);
    });
  }

  /** How much the elevation must change for one more metre of range, near this elevation (a gun's table slope). */
  private elevationPerMetre(elevation: number): number {
    const shell = this.activeShell;
    const env = this.cfg.assumed ?? CALM;
    const e = 0.002;
    const lo = rangeAtElevation(shell, elevation - e, this.muzzleHeight, env);
    const hi = rangeAtElevation(shell, elevation + e, this.muzzleHeight, env);
    if (!lo || !hi || hi.range === lo.range) return 0;
    // Negative on the steep side of a howitzer's table, where more elevation means less range. Never absurdly large near the apex.
    return Math.min(Math.max((2 * e) / (hi.range - lo.range), -0.02), 0.02);
  }

  // ---- reporting for the HUD -------------------------------------------------------------------

  status(ship: ShipFrame): GunneryStatus {
    const c = this.designated;
    let target: GunneryStatus['target'] = null;
    let estimate: GunneryStatus['estimate'] = null;
    let quality: TrackQuality = 'none';
    if (c) {
      const s = this.isVisible(ship, c);
      const bearing = azimuthTo(aimX(c) - ship.x, aimZ(c) - ship.z);
      target = {
        id: c.id,
        name: c.name,
        range: s.range,
        bearingDeg: ((bearing / DEG) % 360 + 360) % 360,
        relativeBearingDeg: ((((bearing - ship.heading) / DEG) % 360) + 540) % 360 - 180,
        visible: s.visible,
        hullDown: s.hullDown,
        clarity: s.clarity,
        spotted: !s.visible && (this.aerial?.sees(c) ?? false),
      };
      const est = this.track.estimate(this.now);
      if (est) {
        estimate = {
          speedKn: Math.hypot(est.vx, est.vz) / 0.514444,
          courseDeg: ((Math.atan2(est.vx, -est.vz) / DEG) % 360 + 360) % 360,
        };
        if (this.now - this.lastSighting > LOST_AFTER) quality = 'lost';
        else if (this.now < this.turnedUntil) quality = 'turned';
        else if (est.samples < 4 || this.track.span(this.now) < 2 * this.plotting.minSpan) quality = 'plotting';
        else quality = est.sigmaSpeed > 0.7 ? 'settling' : 'settled';
      } else {
        quality = s.visible ? 'plotting' : 'lost';
      }
    }
    const oldest = this.world.shells[0];
    return {
      target,
      quality,
      estimate,
      solution: this.solution,
      corrections: this.corrections,
      autoSpot: this.autoSpot,
      turrets: this.battery.status(),
      bearingGuns: this.battery.bearingGuns,
      armed: this.armedAt !== null,
      shellsInFlight: this.world.shells.length,
      nextSplashIn: oldest && this.solution ? Math.max(this.solution.tof - oldest.state.t, 0) : null,
      lastReport: this.lastReport,
      reportAge: this.now - this.lastReportAt,
      shell: this.selected,
      shellChoice: this.shellChoice,
    };
  }

  /** The longest range the guns can reach, metres, in still air. */
  cfgMaxRange(): number {
    const gun = this.cfg.gun;
    // A howitzer's greatest range is at the flattest of its plunging elevations, with the full charge.
    const el = gun.highAngle ? Math.min(PLUNGE_MIN, gun.maxElevationDeg * DEG) : gun.maxElevationDeg * DEG;
    const r = rangeAtElevation(gun.shell, el, this.muzzleHeight);
    return r?.range ?? 0;
  }

  /** Is the designated target within what the guns can reach, by the latest solution? */
  get canReach(): boolean {
    return this.solution?.valid ?? false;
  }

  /** Elevation (radians) that lands a shell `range` metres away in still air, for hand-aimed fire. */
  elevationForRange(range: number): number {
    const gun = this.cfg.gun;
    const el = solveElevation(gun.shell, range, gun.maxElevationDeg * DEG, this.muzzleHeight, this.cfg.assumed ?? CALM);
    return el ?? gun.maxElevationDeg * DEG;
  }
}
