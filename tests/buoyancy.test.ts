import { describe, expect, it } from 'vitest';
import { BATTLESHIP_FLOATING, FloatingBody, fitWaterPlane } from '../src/sim/ships/buoyancy';

const L = 160;
const B = 25;

function settle(
  body: FloatingBody,
  heightAt: (x: number, z: number) => number,
  headingDeg: number,
  seconds = 60,
): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    body.update(1 / 60, fitWaterPlane(heightAt, 0, 0, headingDeg, L, B));
  }
}

describe('fitWaterPlane', () => {
  it('recovers the height and slopes of a tilted plane', () => {
    const plane = fitWaterPlane((x, z) => 1.5 + 0.02 * x - 0.01 * z, 0, 0, 90, L, B);
    // Heading 90 = east: ship forward is +x world, starboard is +z world.
    expect(plane.height).toBeCloseTo(1.5, 6);
    expect(plane.slopeX).toBeCloseTo(0.02, 6);
    expect(plane.slopeZ).toBeCloseTo(-0.01, 6);
  });

  it('rotates with the heading', () => {
    // Slope only along world +x. Facing east it is a pitch slope; facing north it is athwartships.
    const east = fitWaterPlane((x) => 0.03 * x, 0, 0, 90, L, B);
    expect(east.slopeX).toBeCloseTo(0.03, 6);
    expect(east.slopeZ).toBeCloseTo(0, 6);
    const north = fitWaterPlane((x) => 0.03 * x, 0, 0, 0, L, B);
    expect(north.slopeX).toBeCloseTo(0, 6);
    expect(north.slopeZ).toBeCloseTo(0.03, 6); // starboard (east) side is higher
  });
});

describe('FloatingBody', () => {
  const make = () => new FloatingBody(BATTLESHIP_FLOATING(L, B));

  it('sits level on a flat sea', () => {
    const body = make();
    settle(body, () => 0, 0);
    expect(body.heave).toBeCloseTo(0, 4);
    expect(body.pitch).toBeCloseTo(0, 4);
    expect(body.roll).toBeCloseTo(0, 4);
  });

  it('pitches bow-up when the water rises toward the bow', () => {
    const body = make();
    settle(body, (x) => 0.02 * x, 90); // facing east, water higher to the east
    expect(body.pitch).toBeGreaterThan(0.015);
    expect(body.pitch).toBeLessThan(0.021);
  });

  it('rolls starboard-down when the port side is higher', () => {
    const body = make();
    // Facing north (-z world): starboard is +x world. Water higher on the west (port) side.
    settle(body, (x) => -0.03 * x, 0);
    expect(body.roll).toBeGreaterThan(0.02);
  });

  it('rides up with a rising sea level', () => {
    const body = make();
    settle(body, () => 2, 0);
    expect(body.heave).toBeCloseTo(2, 3);
  });

  it('barely responds to waves much shorter than the hull, and follows long ones', () => {
    const amplitudeOf = (wavelength: number): number => {
      const body = make();
      let peak = 0;
      const k = (2 * Math.PI) / wavelength;
      const omega = Math.sqrt(9.81 * k);
      for (let t = 0; t < 120; t += 1 / 60) {
        const plane = fitWaterPlane((x, z) => Math.sin(k * z - omega * t) * 1.0, 0, 0, 90, L, B);
        body.update(1 / 60, plane);
        if (t > 60) peak = Math.max(peak, Math.abs(body.heave));
      }
      return peak;
    };
    const short = amplitudeOf(25);
    const long = amplitudeOf(300);
    expect(long).toBeGreaterThan(0.4);
    expect(short).toBeLessThan(long * 0.4);
  });

  it('a kick decays back to rest', () => {
    const body = make();
    body.kick(0.05, 0);
    let peak = 0;
    for (let t = 0; t < 60; t += 1 / 60) {
      body.update(1 / 60, { height: 0, slopeX: 0, slopeZ: 0 });
      peak = Math.max(peak, Math.abs(body.roll));
    }
    expect(peak).toBeGreaterThan(0.01);
    expect(Math.abs(body.roll)).toBeLessThan(0.002);
  });
});
