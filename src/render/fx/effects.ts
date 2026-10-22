import { Rng } from '../../sim/rng';
import type { ShellKind } from '../../sim/gunnery/shells';
import { GLOW, LAYER_FUNNEL, LAYER_GUNSMOKE, PUFF, type ParticleSystem } from './particles';

type V3 = readonly [number, number, number];

/** The colour a tracer glows, linear: armour-piercing yellow, high-explosive red. */
export const TRACER_COLOUR: Record<ShellKind, readonly [number, number, number]> = {
  ap: [1, 0.9, 0.42],
  he: [1, 0.2, 0.12],
};

/** Reference bore the effect sizes are written for, metres (a 12-inch gun). */
const REF_CALIBER = 0.305;
const G = 9.81;

/**
 * The gunnery spectacle, built from particles: muzzle blasts and the cordite smoke that hangs over the firing ship,
 * the white columns shells throw up where they fall, the burst where they strike a ship, and the shells themselves.
 */
export class Effects {
  /** Draw shells in flight as bright specks with a faint trail. Off for the sternest realism. */
  tracers = true;
  private readonly rng: Rng;

  constructor(
    readonly particles: ParticleSystem,
    seed = 77,
  ) {
    this.rng = new Rng(seed);
  }

  private r(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng.next();
  }

  private g(): number {
    return this.rng.gaussian();
  }

  /** Flash, fireball and a bank of smoke at a muzzle, thrown along `dir`. */
  muzzleBlast(muzzle: V3, dir: V3, caliberM: number): void {
    const s = caliberM / REF_CALIBER;
    const p = this.particles;
    const [mx, my, mz] = muzzle;
    const ahead = (d: number): V3 => [mx + dir[0] * d, my + dir[1] * d, mz + dir[2] * d];

    const f = ahead(3 * s);
    p.spawn({ x: f[0], y: f[1], z: f[2], size0: 26 * s, size1: 40 * s, life: 0.12, r: 1, g: 0.72, b: 0.4, alpha: 16, kind: GLOW });
    p.spawn({ x: f[0], y: f[1], z: f[2], size0: 50 * s, size1: 90 * s, life: 0.2, r: 1, g: 0.6, b: 0.3, alpha: 3.5, kind: GLOW });
    for (let i = 0; i < 4; i++) {
      const a = ahead(this.r(2, 8) * s);
      const sp = this.r(22, 40) * s;
      p.spawn({
        x: a[0],
        y: a[1],
        z: a[2],
        vx: dir[0] * sp + this.g() * 3,
        vy: dir[1] * sp + this.r(0, 5),
        vz: dir[2] * sp + this.g() * 3,
        size0: this.r(8, 13) * s,
        size1: this.r(22, 32) * s,
        life: this.r(0.35, 0.6),
        r: 1,
        g: 0.42,
        b: 0.12,
        alpha: 4,
        kind: GLOW,
        drag: 3.2,
      });
    }
    // Cordite smoke: thrown forward, then stalls and drifts with the wind while it rises and spreads.
    for (let i = 0; i < 7; i++) {
      const a = ahead(this.r(1, 6) * s);
      const sp = this.r(10, 24) * s;
      p.spawn({
        x: a[0],
        y: a[1],
        z: a[2],
        vx: dir[0] * sp + this.g() * 3,
        vy: dir[1] * sp + this.r(1, 4),
        vz: dir[2] * sp + this.g() * 3,
        size0: this.r(8, 12) * s,
        size1: this.r(36, 58) * s,
        life: this.r(13, 22),
        r: 0.36,
        g: 0.32,
        b: 0.28,
        alpha: this.r(0.45, 0.6),
        drag: 0.9,
        gravity: -0.35,
        wind: 0.25,
        spin: this.g() * 0.15,
        fadeIn: 0.12,
        fadePow: 1.5,
        layer: LAYER_GUNSMOKE,
      });
    }
  }

  /** The column of white water a shell throws up when it strikes the sea. `tint` is the dye of the firing ship. */
  shellSplash(x: number, z: number, caliberM: number, tint: V3 = [0.94, 0.97, 1]): void {
    const s = caliberM / REF_CALIBER;
    const p = this.particles;
    const height = 56 * s;
    const [tr, tg, tb] = tint;

    // The column: many small puffs thrown up at speeds that spread them over its height, so it reads as one tall plume
    // that climbs for two or three seconds and then sags back into the sea.
    const n = 22;
    for (let i = 0; i < n; i++) {
      const rise = height * (0.12 + 0.88 * Math.pow((i + 0.5) / n, 0.8));
      const vy = Math.sqrt(2 * G * rise);
      const size = this.r(4, 6.5) * s * (1 - 0.3 * (i / n));
      p.spawn({
        x: x + this.g() * 0.7 * s,
        y: 0.5,
        z: z + this.g() * 0.7 * s,
        vx: this.g() * 0.8,
        vy,
        vz: this.g() * 0.8,
        size0: size,
        size1: size * 1.45,
        life: Math.min((2 * vy) / G + 0.5, 8),
        r: tr,
        g: tg,
        b: tb,
        alpha: 0.9,
        gravity: G * 0.8,
        wind: 0.35,
        fadePow: 0.55,
        spin: this.g() * 0.4,
        dieAtSea: true,
      });
    }
    // The ring of foam thrown out along the surface.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this.r(-0.3, 0.3);
      const sp = this.r(9, 17) * s;
      p.spawn({
        x,
        y: this.r(1, 3),
        z,
        vx: Math.cos(a) * sp,
        vy: this.r(3, 8),
        vz: Math.sin(a) * sp,
        size0: this.r(7, 10) * s,
        size1: this.r(22, 30) * s,
        life: this.r(2.2, 3.2),
        r: tr,
        g: tg,
        b: tb,
        alpha: 0.7,
        drag: 1.1,
        gravity: 5,
        wind: 0.3,
        fadePow: 1.2,
        dieAtSea: true,
      });
    }
    // Mist hanging after the column collapses.
    for (let i = 0; i < 5; i++) {
      p.spawn({
        x: x + this.g() * 4 * s,
        y: this.r(6, 20) * s,
        z: z + this.g() * 4 * s,
        vy: this.r(0.5, 2),
        size0: this.r(18, 26) * s,
        size1: this.r(50, 70) * s,
        life: this.r(5, 9),
        r: tr * 0.92,
        g: tg * 0.94,
        b: tb,
        alpha: 0.22,
        wind: 0.45,
        fadeIn: 0.5,
        fadePow: 1.1,
      });
    }
  }

  /** A shell bursting on a ship: flash, fireball, sparks and black smoke. A high-explosive burst is bigger and redder. */
  hitBurst(x: number, y: number, z: number, caliberM: number, shell: ShellKind = 'ap'): void {
    const he = shell === 'he';
    const s = (caliberM / REF_CALIBER) * (he ? 1.3 : 1);
    const p = this.particles;
    p.spawn({ x, y, z, size0: 60 * s, size1: 90 * s, life: 0.22, r: 1, g: he ? 0.55 : 0.8, b: he ? 0.3 : 0.5, alpha: 22, kind: GLOW });
    for (let i = 0; i < 5; i++) {
      p.spawn({
        x,
        y,
        z,
        vx: this.g() * 14,
        vy: this.r(6, 22),
        vz: this.g() * 14,
        size0: this.r(12, 18) * s,
        size1: this.r(28, 40) * s,
        life: this.r(0.5, 0.95),
        r: 1,
        g: 0.45,
        b: 0.12,
        alpha: 5,
        kind: GLOW,
        drag: 1.8,
        gravity: -2,
      });
    }
    for (let i = 0; i < 10; i++) {
      const sp = this.r(30, 62);
      const a = this.r(0, Math.PI * 2);
      const up = this.r(0.2, 1);
      p.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * sp * (1 - up * 0.5),
        vy: sp * up,
        vz: Math.sin(a) * sp * (1 - up * 0.5),
        size0: 1.6,
        size1: 1,
        life: this.r(0.8, 1.6),
        r: 1,
        g: 0.6,
        b: 0.25,
        alpha: 9,
        kind: GLOW,
        gravity: G,
        drag: 0.3,
      });
    }
    for (let i = 0; i < 10; i++) {
      p.spawn({
        x: x + this.g() * 2,
        y: y + this.r(0, 3),
        z: z + this.g() * 2,
        vx: this.g() * 5,
        vy: this.r(3, 9),
        vz: this.g() * 5,
        size0: this.r(9, 14) * s,
        size1: this.r(40, 62) * s,
        life: this.r(9, 16),
        r: 0.07,
        g: 0.062,
        b: 0.055,
        alpha: this.r(0.7, 0.88),
        drag: 0.55,
        gravity: -0.6,
        wind: 0.2,
        spin: this.g() * 0.2,
        fadeIn: 0.1,
        fadePow: 1.3,
      });
    }
  }

  /**
   * One puff of funnel smoke at a funnel top. `shipVx/shipVz` is the ship's velocity: the smoke leaves with it, then the
   * wind takes over, which is what streams a plume out astern. `intensity` (0..1) grows with engine power.
   */
  funnelPuff(x: number, y: number, z: number, shipVx: number, shipVz: number, intensity: number): void {
    this.particles.spawn({
      x: x + this.g() * 0.6,
      y,
      z: z + this.g() * 0.6,
      vx: shipVx * 0.7 + this.g() * 0.5,
      vy: this.r(2.5, 4.5),
      vz: shipVz * 0.7 + this.g() * 0.5,
      size0: this.r(3, 4.5),
      size1: this.r(18, 30) * (0.7 + 0.5 * intensity),
      life: this.r(12, 17),
      r: 0.05,
      g: 0.047,
      b: 0.045,
      alpha: 0.35 + 0.3 * intensity,
      drag: 0.5,
      gravity: -0.45,
      wind: 0.4,
      spin: this.g() * 0.1,
      fadeIn: 0.25,
      fadePow: 1.2,
      layer: LAYER_FUNNEL,
    });
  }

  /**
   * The smoke a ship makes of herself, her funnels' and her guns' cordite, shows or fades away. The director's sight looks through
   * the place where it streams and hangs, so it is cleared there; the muzzle flash, the splashes and the bursts still show.
   */
  showShipSmoke(on: boolean): void {
    this.particles.setLayerVisible(LAYER_FUNNEL, on);
    this.particles.setLayerVisible(LAYER_GUNSMOKE, on);
  }

  /** One puff of black smoke from a fire aboard. `intensity` (0..1) is how fierce the fire is. */
  fireSmoke(x: number, y: number, z: number, intensity: number): void {
    this.particles.spawn({
      x: x + this.g() * 0.8,
      y,
      z: z + this.g() * 0.8,
      vx: this.g() * 1.2,
      vy: this.r(4, 8),
      vz: this.g() * 1.2,
      size0: this.r(3, 5) * (0.6 + intensity),
      size1: this.r(22, 40) * (0.6 + 0.8 * intensity),
      life: this.r(9, 15),
      r: 0.03,
      g: 0.028,
      b: 0.027,
      alpha: 0.5 + 0.3 * intensity,
      drag: 0.4,
      gravity: -0.8,
      wind: 0.35,
      spin: this.g() * 0.1,
      fadeIn: 0.2,
      fadePow: 1.2,
    });
  }

  /** A lick of flame, to be called often: lives a third of a second. */
  flame(x: number, y: number, z: number, intensity: number): void {
    this.particles.spawn({
      x: x + this.g() * 0.9,
      y: y + this.r(0, 0.8),
      z: z + this.g() * 0.9,
      vy: this.r(2, 6),
      size0: this.r(2.5, 5) * (0.5 + intensity),
      size1: this.r(1.5, 3),
      life: this.r(0.25, 0.5),
      r: 1,
      g: 0.42,
      b: 0.1,
      alpha: 2.5 + 3 * intensity,
      kind: GLOW,
    });
  }

  /** A shell breaking up on armour or glancing off it: a flash and a spray of sparks. */
  armorSpark(x: number, y: number, z: number, caliberM: number, glance = false): void {
    const s = caliberM / REF_CALIBER;
    const p = this.particles;
    p.spawn({ x, y, z, size0: (glance ? 5 : 9) * s, size1: (glance ? 8 : 14) * s, life: 0.12, r: 1, g: 0.8, b: 0.5, alpha: glance ? 6 : 12, kind: GLOW });
    const n = glance ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(14, 40);
      p.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: this.r(4, 22),
        vz: Math.sin(a) * sp,
        size0: 1.1,
        size1: 0.8,
        life: this.r(0.5, 1.2),
        r: 1,
        g: 0.65,
        b: 0.3,
        alpha: 7,
        kind: GLOW,
        gravity: G,
      });
    }
    if (!glance) {
      p.spawn({ x, y, z, vy: 3, size0: 4 * s, size1: 14 * s, life: 3.5, r: 0.28, g: 0.26, b: 0.24, alpha: 0.5, wind: 0.5, fadePow: 1.5 });
    }
  }

  /** A magazine going up: a flash that fills the sky, a fireball, and a black column that climbs for half a minute. */
  explosion(x: number, y: number, z: number, scale = 1): void {
    const p = this.particles;
    p.spawn({ x, y, z, size0: 140 * scale, size1: 260 * scale, life: 0.45, r: 1, g: 0.85, b: 0.6, alpha: 40, kind: GLOW });
    for (let i = 0; i < 12; i++) {
      p.spawn({
        x: x + this.g() * 6 * scale,
        y: y + this.r(0, 8) * scale,
        z: z + this.g() * 6 * scale,
        vx: this.g() * 14 * scale,
        vy: this.r(8, 34) * scale,
        vz: this.g() * 14 * scale,
        size0: this.r(30, 50) * scale,
        size1: this.r(70, 110) * scale,
        life: this.r(1.1, 2.2),
        r: 1,
        g: 0.4,
        b: 0.1,
        alpha: 7,
        kind: GLOW,
        drag: 1.2,
        gravity: -3,
      });
    }
    for (let i = 0; i < 26; i++) {
      p.spawn({
        x: x + this.g() * 8 * scale,
        y: y + this.r(0, 12) * scale,
        z: z + this.g() * 8 * scale,
        vx: this.g() * 10 * scale,
        vy: this.r(10, 30) * scale,
        vz: this.g() * 10 * scale,
        size0: this.r(25, 45) * scale,
        size1: this.r(90, 150) * scale,
        life: this.r(14, 26),
        r: 0.04,
        g: 0.036,
        b: 0.034,
        alpha: this.r(0.7, 0.9),
        drag: 0.45,
        gravity: -1.2,
        wind: 0.2,
        spin: this.g() * 0.15,
        fadeIn: 0.25,
        fadePow: 1.1,
      });
    }
    for (let i = 0; i < 40; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(30, 95) * scale;
      const up = this.r(0.2, 1);
      p.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * sp * (1 - up * 0.4),
        vy: sp * up,
        vz: Math.sin(a) * sp * (1 - up * 0.4),
        size0: 2.2,
        size1: 1.2,
        life: this.r(1.5, 3.5),
        r: 1,
        g: 0.6,
        b: 0.25,
        alpha: 8,
        kind: GLOW,
        gravity: G,
        drag: 0.2,
      });
    }
  }

  /**
   * A shell in flight this frame: a bright speck, yellow for armour-piercing and red for high-explosive, so that a salvo's kind can be
   * read at a glance (the shell buttons on the HUD are the same colours). Call once per frame per shell.
   */
  tracer(x: number, y: number, z: number, shell: ShellKind = 'ap'): void {
    if (!this.tracers) return;
    const [r, g, b] = TRACER_COLOUR[shell];
    this.particles.spawn({ x, y, z, size0: 1.8, size1: 1.8, life: 0.02, r, g, b, alpha: shell === 'he' ? 4 : 3, kind: GLOW });
  }

  /** A little smoke left behind by a shell; call every tenth of a second or so. High-explosive leaves a faintly rosy trail. */
  tracerTrail(x: number, y: number, z: number, shell: ShellKind = 'ap'): void {
    if (!this.tracers) return;
    const he = shell === 'he';
    this.particles.spawn({
      x,
      y,
      z,
      size0: 1.5,
      size1: 6,
      life: 2.2,
      r: he ? 0.95 : 0.85,
      g: he ? 0.68 : 0.85,
      b: he ? 0.62 : 0.88,
      alpha: 0.16,
      kind: PUFF,
      wind: 0.5,
      fadePow: 1.4,
    });
  }

  /** A little foam in a torpedo's wake: the track of bubbles it leaves lasts for a quarter of a minute. */
  torpedoWake(x: number, z: number): void {
    this.particles.spawn({
      x: x + this.g() * 0.4,
      y: 0.35,
      z: z + this.g() * 0.4,
      vx: this.g() * 0.15,
      vz: this.g() * 0.15,
      size0: 2.4,
      size1: this.r(4.5, 6),
      life: this.r(14, 19),
      r: 0.95,
      g: 0.97,
      b: 1,
      alpha: 0.5,
      wind: 0.05,
      fadeIn: 0.4,
      fadePow: 1.3,
    });
  }

  /** The column of water a torpedo throws up against a hull, taller than any shell's, and the black smoke after it. */
  torpedoBlast(x: number, z: number): void {
    this.shellSplash(x, z, 0.85);
    this.hitBurst(x, 3, z, 0.4);
    for (let i = 0; i < 4; i++) {
      this.particles.spawn({
        x: x + this.g() * 3,
        y: 8,
        z: z + this.g() * 3,
        vx: this.g() * 1.5,
        vy: this.r(5, 9),
        vz: this.g() * 1.5,
        size0: this.r(6, 9),
        size1: this.r(30, 48),
        life: this.r(10, 16),
        r: 0.08,
        g: 0.075,
        b: 0.07,
        alpha: 0.55,
        drag: 0.45,
        gravity: -0.5,
        wind: 0.35,
        fadeIn: 0.2,
        fadePow: 1.2,
      });
    }
  }

  /** The white of a chemical smoke screen: a billow that spreads from `r0` to `r1` metres in radius over its life. */
  screenPuff(x: number, z: number, vx: number, vz: number, r0: number, r1: number, life: number): void {
    this.particles.spawn({
      x,
      y: 7,
      z,
      vx,
      vy: 0.5,
      vz,
      size0: r0 * 2,
      size1: r1 * 2,
      life,
      r: 0.8,
      g: 0.82,
      b: 0.84,
      alpha: 0.9,
      spin: this.g() * 0.04,
      fadeIn: 2.5,
      fadePow: 0.7,
    });
  }

  /** The spotter aircraft this frame: a dark fuselage and the spread of its wings. Call every frame it flies. */
  aircraft(x: number, y: number, z: number, headingRad: number): void {
    const p = this.particles;
    const sx = Math.cos(headingRad);
    const sz = Math.sin(headingRad);
    const speck = (dx: number, dz: number, size: number) =>
      p.spawn({ x: x + dx, y, z: z + dz, size0: size, size1: size, life: 0.04, r: 0.05, g: 0.05, b: 0.055, alpha: 1 });
    speck(0, 0, 7);
    speck(sx * 5, sz * 5, 4);
    speck(-sx * 5, -sz * 5, 4);
  }

  /** A mine the aircraft has marked: a black horn at the surface and a small orange light, so that it can be found again. */
  mineMarker(x: number, z: number): void {
    const p = this.particles;
    p.spawn({ x, y: 0.4, z, size0: 2.2, size1: 2.2, life: 0.04, r: 0.03, g: 0.03, b: 0.03, alpha: 1 });
    p.spawn({ x, y: 1.4, z, size0: 6, size1: 6, life: 0.04, r: 1, g: 0.45, b: 0.12, alpha: 2.5, kind: GLOW });
  }

  /** A shell bursting in earth: a fountain of brown dust and rock thrown up, and a cloud that hangs and drifts. */
  groundBurst(x: number, y: number, z: number, caliberM: number): void {
    const s = Math.max(caliberM / REF_CALIBER, 0.3);
    const p = this.particles;
    for (let i = 0; i < 14; i++) {
      const a = this.r(0, Math.PI * 2);
      const sp = this.r(3, 14) * s;
      p.spawn({
        x,
        y: y + 0.5,
        z,
        vx: Math.cos(a) * sp * 0.6,
        vy: this.r(8, 30) * Math.sqrt(s),
        vz: Math.sin(a) * sp * 0.6,
        size0: this.r(3, 5) * s,
        size1: this.r(10, 16) * s,
        life: this.r(2.5, 5),
        r: 0.34,
        g: 0.27,
        b: 0.2,
        alpha: 0.8,
        gravity: 12,
        drag: 0.5,
        wind: 0.2,
        fadePow: 1,
        spin: this.g() * 0.4,
      });
    }
    for (let i = 0; i < 6; i++) {
      p.spawn({
        x: x + this.g() * 2 * s,
        y: y + 2,
        z: z + this.g() * 2 * s,
        vx: this.g() * 1.5,
        vy: this.r(2, 6),
        vz: this.g() * 1.5,
        size0: this.r(8, 12) * s,
        size1: this.r(34, 56) * s,
        life: this.r(9, 16),
        r: 0.3,
        g: 0.26,
        b: 0.22,
        alpha: 0.55,
        drag: 0.4,
        gravity: -0.3,
        wind: 0.35,
        fadeIn: 0.15,
        fadePow: 1.3,
      });
    }
    p.spawn({ x, y: y + 2, z, size0: 10 * s, size1: 20 * s, life: 0.15, r: 1, g: 0.6, b: 0.25, alpha: 5, kind: GLOW });
  }
}
