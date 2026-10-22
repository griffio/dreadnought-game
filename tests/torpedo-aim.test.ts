import { describe, expect, it } from 'vitest';
import { TORPEDO_18_INCH } from '../src/sim/torpedo/spec';
import { aimTorpedoes } from '../src/sim/torpedo/aim';
import { assessTorpedo } from '../src/sim/torpedo/threat';
import { TubeBattery } from '../src/sim/torpedo/tubes';

const DEG = Math.PI / 180;
const own = { x: 0, z: 0, heading: 0, speed: 8, halfLength: 80, halfBeam: 12 };

describe('the bridge reads a wake', () => {
  it('a torpedo running straight at the ship from the beam is a hit, with a time', () => {
    // 1,500 m to starboard, running west at 17.5 m/s while the ship steams north at 8: it must lead her.
    const t = { x: 1500, z: -8 * 86, heading: 270 * DEG, speed: 17.5, run: 0, maxRun: 4200 };
    const v = assessTorpedo(t, own);
    // Broad on the starboard bow.
    expect(v.relative).toBeGreaterThan(55 * DEG);
    expect(v.relative).toBeLessThan(75 * DEG);
    expect(v.range).toBeGreaterThan(1400);
    expect(v.level).toBe('hit');
    expect(v.eta).toBeGreaterThan(70);
    expect(v.eta).toBeLessThan(100);
  });

  it('a torpedo that will pass well astern is clear', () => {
    const t = { x: 1500, z: 800, heading: 270 * DEG, speed: 17.5, run: 0, maxRun: 4200 };
    expect(assessTorpedo(t, own).level).toBe('clear');
  });

  it('one that will pass close astern is called close', () => {
    // Crosses her track 170 m astern of where she will be.
    const t = { x: 1500, z: -8 * 86 + 170, heading: 270 * DEG, speed: 17.5, run: 0, maxRun: 4200 };
    const v = assessTorpedo(t, own);
    expect(v.level).toBe('close');
  });

  it('one that runs out of legs before it arrives, or is moving away, is clear with no time', () => {
    const short = { x: 1500, z: -8 * 86, heading: 270 * DEG, speed: 17.5, run: 3000, maxRun: 3300 };
    expect(assessTorpedo(short, own).eta).toBeNull();
    const away = { x: 1500, z: 0, heading: 90 * DEG, speed: 17.5, run: 0, maxRun: 4200 };
    expect(assessTorpedo(away, own).level).toBe('clear');
  });

  it('is easier to dodge by turning toward it: head on the hull is narrow', () => {
    // The same wake, once the ship has swung to meet it.
    const t = { x: 1500, z: 0, heading: 270 * DEG, speed: 17.5, run: 0, maxRun: 4200 };
    const abeam = assessTorpedo(t, { ...own, heading: 0, speed: 0 });
    expect(abeam.level).toBe('hit');
    // Ship pointing at it, torpedo passing 60 m off the centreline: wider than her beam, so it misses.
    const nose = assessTorpedo({ ...t, z: 60 }, { ...own, heading: 90 * DEG, speed: 0 });
    expect(nose.level).not.toBe('hit');
  });
});

describe('the torpedo firing solution', () => {
  it('leads a crossing target, and tells a ship with fixed beam tubes to turn', () => {
    const tubes = new TubeBattery([
      { id: 'TP', x: 40, z: 0, arcDeg: [-108, -72], trainRateDegPerSec: 0, reloadSeconds: 150, rounds: 2, restBearingDeg: -90 },
      { id: 'TS', x: 40, z: 0, arcDeg: [72, 108], trainRateDegPerSec: 0, reloadSeconds: 150, rounds: 2, restBearingDeg: 90 },
    ]);
    // Target 3,000 m dead ahead steaming across to starboard at 10 m/s.
    const aim = aimTorpedoes({ x: 0, z: 0, heading: 0 }, { x: 0, z: -3000, vx: 10, vz: 0 }, TORPEDO_18_INCH.settings[0]!.speed, TORPEDO_18_INCH.settings[0]!.range, tubes)!;
    expect(aim).not.toBeNull();
    // She is led to starboard of the bow.
    expect(aim.relative).toBeGreaterThan(10 * DEG);
    expect(aim.relative).toBeLessThan(60 * DEG);
    expect(aim.inReach).toBe(true);
    expect(aim.loaded).toBe(2);
    expect(aim.bearing).toBe(0);
    // Turn to port until the starboard tube's arc reaches the bearing: the target moves out toward the beam.
    expect(aim.turn).toBeLessThan(0);
    expect(aim.turn).toBeCloseTo(aim.relative - 72 * DEG, 2);
  });

  it('bears when the bearing is in a tube arc, and says so', () => {
    const tubes = new TubeBattery([{ id: 'TS', x: 40, z: 0, arcDeg: [72, 108], trainRateDegPerSec: 0, reloadSeconds: 150, rounds: 2, restBearingDeg: 90 }]);
    const aim = aimTorpedoes({ x: 0, z: 0, heading: 0 }, { x: 2800, z: 0, vx: 0, vz: 3 }, 17.5, 4200, tubes)!;
    expect(aim.bearing).toBe(1);
    expect(aim.turn).toBe(0);
  });

  it('is out of reach when the run is longer than the legs', () => {
    const tubes = new TubeBattery([{ id: 'TS', x: 40, z: 0, arcDeg: [72, 108], trainRateDegPerSec: 0, reloadSeconds: 150, rounds: 2, restBearingDeg: 90 }]);
    const aim = aimTorpedoes({ x: 0, z: 0, heading: 0 }, { x: 6000, z: 0, vx: 0, vz: 0 }, 17.5, 4200, tubes)!;
    expect(aim.inReach).toBe(false);
  });
});
