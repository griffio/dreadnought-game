import { describe, expect, it } from 'vitest';
import { airDensity, speedOfSound } from '../src/sim/gunnery/atmosphere';
import {
  CALM,
  dragCoefficient,
  flyToSea,
  launch,
  rangeAtElevation,
  solveElevation,
  type Environment,
} from '../src/sim/gunnery/ballistics';
import { DEFAULT_DISPERSION, newSalvoBias, shotJitter } from '../src/sim/gunnery/dispersion';
import { azimuthTo, solveFiring } from '../src/sim/gunnery/fire-control';
import { GUN_12_45_MK_X, GUN_15_42_MK_I } from '../src/sim/gunnery/guns';
import { measureRange, newRangefinderBias, rangefinderSigma, RANGEFINDER_15FT, RANGEFINDER_9FT } from '../src/sim/gunnery/rangefinder';
import { AutoSpotter, fallRelativeToTarget, reportSalvo, type ShellFall } from '../src/sim/gunnery/spotting';
import { TargetTrack } from '../src/sim/gunnery/target-track';
import { Rng } from '../src/sim/rng';

const DEG = Math.PI / 180;
const yd = (m: number) => m / 0.9144;
const KNOT = 0.514444;

describe('atmosphere', () => {
  it('matches sea-level standard values and thins with height', () => {
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
    expect(speedOfSound(0)).toBeCloseTo(340.3, 0);
    expect(airDensity(5000)).toBeLessThan(airDensity(0) * 0.65);
    expect(speedOfSound(5000)).toBeLessThan(speedOfSound(0));
  });
});

describe('drag coefficient', () => {
  it('rises sharply through Mach 1 and falls away supersonic', () => {
    expect(dragCoefficient(0.5)).toBeLessThan(0.15);
    expect(dragCoefficient(1.05)).toBeGreaterThan(0.38);
    expect(dragCoefficient(2.5)).toBeLessThan(dragCoefficient(1.1));
    expect(dragCoefficient(10)).toBe(dragCoefficient(3));
  });
});

describe('ballistics', () => {
  const g12 = GUN_12_45_MK_X.shell;
  const g15 = GUN_15_42_MK_I.shell;

  it('without air the integrator reproduces the vacuum range v^2 sin(2t)/g', () => {
    const vacuum: Environment = { ...CALM, densityScale: 0 };
    for (const el of [5, 15, 30, 45]) {
      const r = rangeAtElevation(g12, el * DEG, 0.001, vacuum)!;
      const expected = (g12.muzzleVelocity ** 2 * Math.sin(2 * el * DEG)) / 9.81;
      expect(Math.abs(r.range - expected) / expected).toBeLessThan(0.004);
    }
  });

  it('drag shortens the range a great deal, and more for a blunter shell', () => {
    const vac = rangeAtElevation(g12, 30 * DEG, 12, { ...CALM, densityScale: 0 })!.range;
    const air = rangeAtElevation(g12, 30 * DEG, 12)!.range;
    expect(air).toBeLessThan(vac * 0.6);
    const streamlined = rangeAtElevation({ ...g12, formFactor: 1 }, 30 * DEG, 12)!.range;
    expect(streamlined).toBeGreaterThan(air);
  });

  it('is consistent with published range tables to about 10 per cent', () => {
    // 12"/45 Mk X: about 25,000 yd at 30 degrees. 15"/42 Mk I: about 30,000 yd at 30 degrees.
    expect(yd(rangeAtElevation(g12, 30 * DEG)!.range)).toBeGreaterThan(22500);
    expect(yd(rangeAtElevation(g12, 30 * DEG)!.range)).toBeLessThan(27500);
    expect(yd(rangeAtElevation(g15, 30 * DEG)!.range)).toBeGreaterThan(28000);
    expect(yd(rangeAtElevation(g15, 30 * DEG)!.range)).toBeLessThan(35500);
    // The Dreadnought's 13.5 degree mounts reach well beyond 15 km.
    const reach = rangeAtElevation(g12, 13.5 * DEG)!.range;
    expect(reach).toBeGreaterThan(15000);
    expect(reach).toBeLessThan(19500);
  });

  it('range grows with elevation up to the optimum and the shell comes down steeper at long range', () => {
    let last = 0;
    let lastAngle = 0;
    for (const el of [2, 5, 8, 11, 14, 20, 25]) {
      const r = rangeAtElevation(g12, el * DEG)!;
      expect(r.range).toBeGreaterThan(last);
      expect(r.angleDeg).toBeGreaterThan(lastAngle);
      last = r.range;
      lastAngle = r.angleDeg;
    }
  });

  it('flight time at 12 km is in the tens of seconds, and the shell arrives slower than it left', () => {
    const el = solveElevation(g12, 12000, 13.5 * DEG)!;
    const r = rangeAtElevation(g12, el)!;
    expect(r.tof).toBeGreaterThan(14);
    expect(r.tof).toBeLessThan(26);
    expect(r.speed).toBeLessThan(g12.muzzleVelocity * 0.8);
    expect(r.speed).toBeGreaterThan(300);
  });

  it('solveElevation inverts rangeAtElevation, and refuses ranges the gun cannot reach', () => {
    for (const range of [3000, 8000, 12000, 15500]) {
      const el = solveElevation(g12, range, 13.5 * DEG)!;
      expect(el).not.toBeNull();
      expect(Math.abs(rangeAtElevation(g12, el)!.range - range)).toBeLessThan(5);
    }
    expect(solveElevation(g12, 30000, 13.5 * DEG)).toBeNull();
  });

  it('a tailwind lengthens the range, a crosswind pushes the fall downwind', () => {
    const el = solveElevation(g12, 12000, 13.5 * DEG)!;
    const fire = (env: Environment) => flyToSea(launch(g12, [0, 12, 0], 0, el), g12, env)!; // fired north (-z)
    const calm = fire(CALM);
    const tail = fire({ ...CALM, windZ: -15 }); // blowing toward the north: with the shell
    const head = fire({ ...CALM, windZ: 15 });
    expect(-tail.z).toBeGreaterThan(-calm.z + 30);
    expect(-head.z).toBeLessThan(-calm.z - 30);
    const cross = fire({ ...CALM, windX: 15 }); // blowing east
    expect(cross.x).toBeGreaterThan(calm.x + 20);
  });

  it('Coriolis deflects shells to the right in the northern hemisphere', () => {
    const el = solveElevation(g15, 20000, 20 * DEG)!;
    const env: Environment = { ...CALM, coriolisLatitudeDeg: 50 };
    const north = flyToSea(launch(g15, [0, 12, 0], 0, el), g15, env)!;
    const baseNorth = flyToSea(launch(g15, [0, 12, 0], 0, el), g15, CALM)!;
    expect(north.x - baseNorth.x).toBeGreaterThan(15); // east is right of north
    expect(north.x - baseNorth.x).toBeLessThan(120); // tens of metres at 20 km
    const east = flyToSea(launch(g15, [0, 12, 0], 90 * DEG, el), g15, env)!;
    const baseEast = flyToSea(launch(g15, [0, 12, 0], 90 * DEG, el), g15, CALM)!;
    expect(east.z - baseEast.z).toBeGreaterThan(15); // south (+z) is right of east
  });

  it('the shell inherits the ship\'s velocity', () => {
    const el = solveElevation(g12, 10000, 13.5 * DEG)!;
    const still = flyToSea(launch(g12, [0, 12, 0], 0, el), g12, CALM)!;
    const moving = flyToSea(launch(g12, [0, 12, 0], 0, el, [10, 0]), g12, CALM)!; // ship moving east at 10 m/s
    // Over ~16 s of flight the shell is carried roughly 100 m east less drag.
    expect(moving.x - still.x).toBeGreaterThan(60);
    expect(moving.x - still.x).toBeLessThan(160);
  });
});

describe('dispersion', () => {
  it('range scatter of one shell is a fraction of a per cent of range, and salvos wander as groups', () => {
    const rng = new Rng(5);
    const el = solveElevation(GUN_12_45_MK_X.shell, 12000, 13.5 * DEG)!;
    const ranges: number[] = [];
    const lateral: number[] = [];
    for (let s = 0; s < 40; s++) {
      const bias = newSalvoBias(rng, DEFAULT_DISPERSION);
      for (let i = 0; i < 8; i++) {
        const j = shotJitter(rng, DEFAULT_DISPERSION, bias);
        const hit = flyToSea(
          launch(GUN_12_45_MK_X.shell, [0, 12, 0], j.dAzimuth, el + j.dElevation, [0, 0], j.velocityScale),
          GUN_12_45_MK_X.shell,
          CALM,
        )!;
        ranges.push(-hit.z);
        lateral.push(hit.x);
      }
    }
    const sd = (a: number[]) => {
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
    };
    const rangeSd = sd(ranges);
    expect(rangeSd).toBeGreaterThan(30);
    expect(rangeSd).toBeLessThan(110);
    expect(sd(lateral)).toBeLessThan(rangeSd * 0.4); // much tighter across than along
  });
});

describe('rangefinder', () => {
  it('error grows with the square of range and shrinks with a longer base', () => {
    const near = rangefinderSigma(5000, RANGEFINDER_9FT);
    const far = rangefinderSigma(10000, RANGEFINDER_9FT);
    expect(far / near).toBeCloseTo(4, 1);
    expect(rangefinderSigma(10000, RANGEFINDER_15FT)).toBeLessThan(far * 0.7);
    expect(rangefinderSigma(10000, RANGEFINDER_9FT, 10)).toBeGreaterThan(far * 2);
  });

  it('single readings at 12 km are off by about a hundred metres, plus a systematic error averaging cannot remove', () => {
    const sigma = rangefinderSigma(12000, RANGEFINDER_9FT);
    expect(sigma).toBeGreaterThan(50);
    expect(sigma).toBeLessThan(200);
    const rng = new Rng(2);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += measureRange(rng, 12000, RANGEFINDER_9FT) - 12000;
    expect(Math.abs(sum / 2000)).toBeLessThan(10);
  });
});

describe('TargetTrack', () => {
  const observeSteady = (track: TargetTrack, seconds: number, noise: boolean, seed = 1) => {
    const rng = new Rng(seed);
    for (let t = 0; t <= seconds; t += 2) {
      // Own ship fixed at the origin; target 12 km north-east moving east at 9 m/s.
      const tx = 6000 + 9 * t;
      const tz = -10000;
      const range = Math.hypot(tx, tz);
      const bearing = Math.atan2(tx, -tz);
      track.observe(
        t,
        0,
        0,
        noise ? range + rng.gaussian() * 100 : range,
        bearing + (noise ? rng.gaussian() * 0.0008 : 0),
      );
    }
  };

  it('recovers a steady course and speed from clean observations', () => {
    const track = new TargetTrack();
    observeSteady(track, 60, false);
    const e = track.estimate(60)!;
    // Shrunk a little toward "not moving" by the honest uncertainty of the plot.
    expect(e.vx).toBeGreaterThan(8.5);
    expect(e.vx).toBeLessThan(9.05);
    expect(Math.abs(e.vz)).toBeLessThan(0.1);
    expect(e.x).toBeCloseTo(6000 + 9 * 60, 0);
  });

  it('settles with noisy readings: within a knot or two after a minute, with the uncertainty shrinking', () => {
    const early = new TargetTrack();
    const late = new TargetTrack();
    observeSteady(early, 14, true);
    observeSteady(late, 70, true);
    const a = early.estimate(14)!;
    const b = late.estimate(70)!;
    expect(b.sigmaSpeed).toBeLessThan(a.sigmaSpeed * 0.5);
    expect(Math.hypot(b.vx - 9, b.vz)).toBeLessThan(2.5);
  });

  it('is wrong right after a turn, and recovers as the old samples age out', () => {
    const track = new TargetTrack();
    for (let t = 0; t <= 100; t += 2) {
      // East at 9 m/s until t = 50, then north at 9 m/s.
      const east = t <= 50 ? 9 * t : 450;
      const north = t <= 50 ? 0 : 9 * (t - 50);
      track.observe(t, 0, 0, Math.hypot(6000 + east, -(10000 + north)), Math.atan2(6000 + east, 10000 + north));
    }
    // Immediately after the turn the fitted course is a blend of the two legs; by the end it is nearly north.
    const justAfter = new TargetTrack();
    for (let t = 0; t <= 56; t += 2) {
      const east = t <= 50 ? 9 * t : 450;
      const north = t <= 50 ? 0 : 9 * (t - 50);
      justAfter.observe(t, 0, 0, Math.hypot(6000 + east, -(10000 + north)), Math.atan2(6000 + east, 10000 + north));
    }
    const wrong = justAfter.estimate(56)!;
    const right = track.estimate(100)!;
    // Target moves toward -z... here "north" is increasing distance so z gets more negative.
    expect(Math.abs(wrong.vz)).toBeLessThan(Math.abs(right.vz));
    expect(Math.abs(right.vx)).toBeLessThan(Math.abs(wrong.vx));
  });
});

describe('solveFiring', () => {
  const spec = GUN_12_45_MK_X.shell;
  const maxEl = 13.5 * DEG;
  const own = { x: 0, z: 0, vx: 0, vz: 0, muzzleHeight: 12 };

  it('a stationary target in still air: the shell lands on it', () => {
    const target = { x: 3000, z: -11000, vx: 0, vz: 0 };
    const sol = solveFiring(own, target, spec, maxEl);
    expect(sol.valid).toBe(true);
    const hit = flyToSea(launch(spec, [0, 12, 0], sol.azimuth, sol.elevation), spec, CALM)!;
    expect(Math.hypot(hit.x - target.x, hit.z - target.z)).toBeLessThan(6);
  });

  it('leads a moving target: it aims ahead of where the target is now', () => {
    const target = { x: 0, z: -10000, vx: 9, vz: 0 }; // crossing east at 9 m/s
    const sol = solveFiring(own, target, spec, maxEl);
    expect(sol.aimX).toBeGreaterThan(100);
    expect(sol.azimuth).toBeGreaterThan(azimuthTo(0, -10000) + 0.005);
    const hit = flyToSea(launch(spec, [0, 12, 0], sol.azimuth, sol.elevation), spec, CALM)!;
    // Where the target will be when the shell lands:
    const tx = target.x + target.vx * hit.tof;
    expect(Math.hypot(hit.x - tx, hit.z - target.z)).toBeLessThan(8);
  });

  it('allows for the firing ship\'s own speed', () => {
    const target = { x: 0, z: -9000, vx: 0, vz: 0 };
    const moving = { ...own, vx: 10, vz: 0 }; // own ship steaming east, firing north
    const sol = solveFiring(moving, target, spec, maxEl);
    // It must aim to the left of the target (west) because the shell is carried east.
    expect(sol.azimuth).toBeLessThan(0);
    const hit = flyToSea(launch(spec, [0, 12, 0], sol.azimuth, sol.elevation, [10, 0]), spec, CALM)!;
    expect(Math.hypot(hit.x - target.x, hit.z - target.z)).toBeLessThan(8);
  });

  it('spotting corrections move the aim point along and across the line of fire', () => {
    const target = { x: 0, z: -10000, vx: 0, vz: 0 };
    const base = solveFiring(own, target, spec, maxEl);
    const over = solveFiring(own, target, spec, maxEl, { range: 300, deflection: 0 });
    const right = solveFiring(own, target, spec, maxEl, { range: 0, deflection: 50 });
    expect(over.elevation).toBeGreaterThan(base.elevation);
    expect(over.range - base.range).toBeCloseTo(300, 0);
    expect(right.aimX - base.aimX).toBeCloseTo(50, 0);
  });

  it('flags a target beyond the reach of the mounts', () => {
    const sol = solveFiring(own, { x: 0, z: -24000, vx: 0, vz: 0 }, spec, maxEl);
    expect(sol.valid).toBe(false);
  });

  it('converges quickly when warm-started from the last solution', () => {
    const target = { x: 500, z: -11000, vx: 5, vz: 2 };
    const first = solveFiring(own, target, spec, maxEl);
    const second = solveFiring(own, { ...target, x: 505 }, spec, maxEl, undefined, CALM, first);
    expect(second.iterations).toBeLessThanOrEqual(first.iterations);
    expect(Math.abs(second.elevation - first.elevation)).toBeLessThan(0.003);
  });
});

describe('spotting', () => {
  it('classifies a fall relative to the line of fire', () => {
    // Firing north (-z) at a target 10 km away; a splash 200 m beyond and 30 m east of it.
    const f = fallRelativeToTarget(0, 0, 0, -10000, 30, -10200, false);
    expect(f.range).toBeCloseTo(200, 3);
    expect(f.deflection).toBeCloseTo(30, 3); // east is right of north
  });

  it('calls HIT, STRADDLE, SHORT and OVER', () => {
    const fall = (range: number, deflection = 0, hit = false): ShellFall => ({ range, deflection, hit });
    expect(reportSalvo(1, [fall(-100), fall(80, 0, true)]).call).toBe('HIT');
    expect(reportSalvo(1, [fall(-200), fall(150)]).call).toBe('STRADDLE');
    expect(reportSalvo(1, [fall(-300), fall(-250)]).call).toBe('SHORT');
    expect(reportSalvo(1, [fall(300), fall(260)]).call).toBe('OVER');
    expect(reportSalvo(1, [fall(-300), fall(-250)]).text).toMatch(/SHORT 280/);
  });

  it('the corrector walks toward the target without overshooting wildly', () => {
    const spotter = new AutoSpotter();
    // Salvo fell 600 m short, all shells.
    spotter.apply(reportSalvo(1, [-620, -580, -600].map((range) => ({ range, deflection: 0, hit: false }))));
    expect(spotter.range).toBeGreaterThan(450);
    expect(spotter.range).toBeLessThan(620);
    // Next salvo straddled with a mean 60 m over: a small pull back.
    const before = spotter.range;
    spotter.apply(reportSalvo(2, [-120, 240].map((range) => ({ range, deflection: 0, hit: false }))));
    expect(spotter.range).toBeLessThan(before);
    expect(Math.abs(spotter.range - before)).toBeLessThan(80);
  });
});

/**
 * The milestone's acceptance test, headless: a 12 km stationary target, a moving ship with a noisy rangefinder, wind and
 * Coriolis the solver does not know about, 10-shell salvos with dispersion, and the bracketing corrector.
 */
describe('duel at 12 km (acceptance)', () => {
  const spec = GUN_12_45_MK_X.shell;
  const maxEl = 13.5 * DEG;
  const HULL = { length: 160, beam: 25 };

  function salvosToFirstHit(seed: number, targetSpeedKn = 0): number {
    const rng = new Rng(seed);
    const own = { x: 0, z: 0, speed: 8 * KNOT, heading: 0 }; // north at 8 knots
    const target = { x: 4200, z: -11200, course: 90 * DEG, speed: targetSpeedKn * KNOT };
    const env: Environment = { ...CALM, windX: 7, windZ: 3, coriolisLatitudeDeg: 52 };
    const track = new TargetTrack();
    const spotter = new AutoSpotter();
    const rfBias = newRangefinderBias(rng, RANGEFINDER_9FT);
    let t = 0;
    let solution: ReturnType<typeof solveFiring> | undefined;

    // Plot the target for a minute before the first salvo, a reading every 2 s.
    const advance = (dt: number) => {
      t += dt;
      own.x += Math.sin(own.heading) * own.speed * dt;
      own.z -= Math.cos(own.heading) * own.speed * dt;
      target.x += Math.sin(target.course) * target.speed * dt;
      target.z -= Math.cos(target.course) * target.speed * dt;
    };
    const plot = (seconds: number) => {
      for (let i = 0; i < seconds / 2; i++) {
        advance(2);
        const range = Math.hypot(target.x - own.x, target.z - own.z);
        const bearing = azimuthTo(target.x - own.x, target.z - own.z);
        track.observe(t, own.x, own.z, measureRange(rng, range, RANGEFINDER_9FT, 40, rfBias), bearing + rng.gaussian() * 0.0006);
      }
    };
    plot(60);

    for (let salvo = 1; salvo <= 8; salvo++) {
      const est = track.estimate(t)!;
      const ownState = { x: own.x, z: own.z, vx: Math.sin(own.heading) * own.speed, vz: -Math.cos(own.heading) * own.speed, muzzleHeight: 12 };
      solution = solveFiring(ownState, est, spec, maxEl, { range: spotter.range, deflection: spotter.deflection }, CALM, solution);
      const bias = newSalvoBias(rng, DEFAULT_DISPERSION);
      const falls: ShellFall[] = [];
      let tofMax = 0;
      for (let g = 0; g < 10; g++) {
        const j = shotJitter(rng, DEFAULT_DISPERSION, bias);
        const shot = launch(
          spec,
          [own.x, 12, own.z],
          solution.azimuth + j.dAzimuth,
          solution.elevation + j.dElevation,
          [ownState.vx, ownState.vz],
          j.velocityScale,
        );
        const impact = flyToSea(shot, spec, env, 0.05);
        if (!impact) continue;
        tofMax = Math.max(tofMax, impact.tof);
        // Where the stationary-or-moving target is when this shell lands (it moved on during the flight).
        const tx = target.x + Math.sin(target.course) * target.speed * impact.tof;
        const tz = target.z - Math.cos(target.course) * target.speed * impact.tof;
        const dx = impact.x - tx;
        const dz = impact.z - tz;
        // Hit if inside the hull rectangle, which lies along the target's course.
        const along = dx * Math.sin(target.course) - dz * Math.cos(target.course);
        const across = dx * Math.cos(target.course) + dz * Math.sin(target.course);
        const hit = Math.abs(along) < HULL.length / 2 && Math.abs(across) < HULL.beam / 2;
        falls.push(fallRelativeToTarget(own.x, own.z, tx, tz, impact.x, impact.z, hit));
      }
      const report = reportSalvo(salvo, falls);
      if (report.hits > 0) return salvo;
      spotter.apply(report);
      // Keep plotting during the reload.
      plot(26);
    }
    return 99;
  }

  it('lands the first hit on a stationary target within four salvos, nearly every time', () => {
    const results = Array.from({ length: 100 }, (_, i) => salvosToFirstHit(1000 + i * 17));
    const within4 = results.filter((n) => n <= 4).length;
    const median = [...results].sort((a, b) => a - b)[Math.floor(results.length / 2)]!;
    expect(within4 / results.length).toBeGreaterThanOrEqual(0.85);
    expect(median).toBeLessThanOrEqual(3);
  }, 120_000);

  it('also finds a target steaming at 8 knots, if a little less reliably', () => {
    const results = Array.from({ length: 60 }, (_, i) => salvosToFirstHit(7000 + i * 31, 8));
    const within5 = results.filter((n) => n <= 5).length;
    expect(within5 / results.length).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
