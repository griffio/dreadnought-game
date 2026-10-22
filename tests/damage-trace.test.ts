import { describe, expect, it } from 'vitest';
import { DREADNOUGHT_DAMAGE } from '../src/data/ships/dreadnought-damage';
import { DREADNOUGHT } from '../src/data/ships/dreadnought';
import { buildHitGeometry, type V3 } from '../src/sim/damage/geometry';
import {
  FUZE_DELAY_SECONDS,
  penetrationMm,
  REFERENCE_SHELL,
  RICOCHET_COS,
  throughPlate,
} from '../src/sim/damage/penetration';
import { traceShell, zoneAt, type TraceResult } from '../src/sim/damage/trace';
import { rangeAtElevation, solveElevation } from '../src/sim/gunnery/ballistics';
import { GUN_12_45_MK_X } from '../src/sim/gunnery/guns';

const DEG = Math.PI / 180;
const shell = GUN_12_45_MK_X.shell;
const geom = buildHitGeometry(DREADNOUGHT, DREADNOUGHT_DAMAGE);
const rest = (id: string) => DREADNOUGHT.turrets.find((t) => t.id === id)!.restTrainDeg * DEG;

/** What a 12-inch shell fired from `range` metres is doing when it arrives: speed and descent angle. */
function arrival(range: number): { speed: number; angleDeg: number } {
  const el = solveElevation(shell, range, 13.5 * DEG)!;
  const r = rangeAtElevation(shell, el)!;
  return { speed: r.speed, angleDeg: r.angleDeg };
}

/**
 * Fire a shell at a point on the ship from the port beam, `yawDeg` off square (positive turns the shell toward the bow),
 * with the descent angle and speed it would have at `range`. Returns the trace.
 */
function shoot(aim: V3, range: number, yawDeg = 0, trains: Record<string, number> = {}): TraceResult | null {
  const { speed, angleDeg } = arrival(range);
  const a = angleDeg * DEG;
  const yaw = yawDeg * DEG;
  const dir: V3 = [Math.sin(yaw) * Math.cos(a), -Math.sin(a), Math.cos(yaw) * Math.cos(a)];
  const origin: V3 = [aim[0] - dir[0] * 40, aim[1] - dir[1] * 40, aim[2] - dir[2] * 40];
  return traceShell(
    geom,
    (id) => trains[id] ?? rest(id),
    { massKg: shell.massKg, diameterMm: shell.diameterM * 1000, speed },
    { origin, dir, segment: 60 },
  );
}

describe('penetration', () => {
  const ref = REFERENCE_SHELL;

  it('is calibrated to the reference shell and falls off with speed', () => {
    expect(penetrationMm(ref.massKg, ref.diameterMm, ref.speed)).toBeCloseTo(ref.penetrationMm, 3);
    const p5 = penetrationMm(ref.massKg, ref.diameterMm, arrival(5000).speed);
    const p10 = penetrationMm(ref.massKg, ref.diameterMm, arrival(10000).speed);
    expect(p5).toBeGreaterThan(215);
    expect(p5).toBeLessThan(290);
    expect(p10).toBeGreaterThan(130);
    expect(p10).toBeLessThan(200);
    expect(p10).toBeLessThan(p5);
  });

  it('a lighter, smaller shell defeats less armour at the same speed', () => {
    const big = penetrationMm(386, 305, 700);
    const small = penetrationMm(240, 280, 700);
    expect(small).toBeLessThan(big * 0.9);
    expect(small).toBeGreaterThan(big * 0.55);
  });

  it('plates: thin ones are passed through, thick ones stop a shell that cannot defeat them, glancing blows ricochet', () => {
    const thin = throughPlate(600, 386, 305, 12, 1);
    expect(thin.outcome).toBe('penetrate');
    expect(thin.speed).toBeGreaterThan(590);
    expect(throughPlate(600, 386, 305, 150, 1).outcome).toBe('penetrate');
    expect(throughPlate(600, 386, 305, 330, 1).outcome).toBe('shatter');
    expect(throughPlate(700, 386, 305, 100, RICOCHET_COS - 0.02).outcome).toBe('ricochet');
    // Obliquity makes a plate effectively thicker.
    const square = throughPlate(600, 386, 305, 200, 1);
    const slanted = throughPlate(600, 386, 305, 200, 0.6);
    expect(square.outcome).toBe('penetrate');
    expect(slanted.outcome).toBe('shatter');
    // A shell that only just gets through is slowed far more than one that goes through easily.
    expect(throughPlate(600, 386, 305, 220, 1).speed).toBeLessThan(throughPlate(600, 386, 305, 60, 1).speed);
  });
});

describe('hit geometry of the Dreadnought', () => {
  it('has plates and zones for hull, barbettes, turrets, funnels and the bridge, all finite', () => {
    expect(geom.plates.length).toBeGreaterThan(60);
    expect(geom.turrets.length).toBe(15); // five main turrets and ten 12-pounders
    expect(geom.zones.filter((z) => z.kind === 'compartment').length).toBe(DREADNOUGHT_DAMAGE.compartments.length);
    for (const p of geom.plates) {
      expect(Number.isFinite(p.coord) && p.mm > 0).toBe(true);
      expect(p.hi[0]).toBeGreaterThanOrEqual(p.lo[0]);
      expect(p.hi[1]).toBeGreaterThanOrEqual(p.lo[1]);
    }
  });

  it('finds the compartment, barbette and turret a point is in', () => {
    const train = (id: string) => rest(id);
    expect(zoneAt(geom, [30, -2, 0], train)?.ref).toBe('boiler-1');
    expect(zoneAt(geom, [-50, -3, 0], train)?.ref).toBe('mag-X');
    expect(zoneAt(geom, [56, 3, 0], train)?.kind).toBe('barbette'); // inside A's barbette
    expect(zoneAt(geom, [56, 8.2, 0], train)?.kind).toBe('turret'); // inside A's house
    expect(zoneAt(geom, [0, 40, 100], train)).toBeNull();
  });

  it('a turret\'s house turns with it: the same point is inside or outside depending on the training', () => {
    // Turret P stands at x = 9, z = -8.7 and its house is a rounded-off square about 8 m a side. A point at its forward
    // starboard corner is inside it trained ahead and outside it turned 45 degrees, when the corner has swung away.
    const p: V3 = [9 + 3.9, 8.0, -8.7 + 3.9];
    expect(zoneAt(geom, p, () => 0)?.kind).toBe('turret');
    expect(zoneAt(geom, p, () => 45 * DEG)?.kind).not.toBe('turret');
  });
});

describe('a shell through the Dreadnought', () => {
  it('goes through the belt at short range and bursts in the boiler room behind it', () => {
    const r = shoot([30, 0.4, -12.4], 2500)!;
    expect(r.kind).toBe('burst');
    expect(r.first.kind).toBe('belt');
    expect(r.zone?.ref).toBe('boiler-1');
    // The burst is a fuze delay's travel inside the hull: some metres past the side.
    expect(r.at[2]).toBeGreaterThan(-12.4 + 4);
    expect(r.speed * FUZE_DELAY_SECONDS).toBeGreaterThan(4);
  });

  it('shatters on the belt at long range', () => {
    const r = shoot([30, 0.4, -12.4], 10000)!;
    expect(r.kind).toBe('shatter');
    expect(r.stoppedBy?.kind).toBe('belt');
  });

  it('the thinly plated bow is no protection at any range', () => {
    const r = shoot([66, 2, -4.8], 10000, 25)!;
    expect(['burst', 'pass']).toContain(r.kind);
    expect(r.kind).not.toBe('shatter');
  });

  it('upper side armour is defeated at medium range but not at long range', () => {
    const near = shoot([32, 4.5, -12.4], 5000)!;
    expect(near.kind).toBe('burst');
    expect(near.first.kind).toBe('upper-side');
    const far = shoot([32, 4.5, -12.4], 12000)!;
    expect(far.kind === 'shatter' || far.kind === 'ricochet').toBe(true);
  });

  it('a turret face resists at long range and is defeated at short range; the house is where it bursts', () => {
    // Turret A trained to port, facing the shell: its face is the plate struck.
    const trains = { A: -90 * DEG };
    const aim: V3 = [56, 8.0, -3.5];
    const far = shoot(aim, 9000, 0, trains)!;
    expect(far.kind).toBe('shatter');
    expect(far.stoppedBy?.kind).toBe('turret-face');
    const near = shoot(aim, 1800, 0, trains)!;
    expect(near.kind).toBe('burst');
    expect(near.zone?.kind).toBe('turret');
    expect(near.zone?.ref).toBe('A');
  });

  it('light structure does not set the fuze off: a shell through the funnel top passes on', () => {
    const r = shoot([26, 12.5, -2], 8000)!;
    expect(r.kind).toBe('pass');
    expect(r.crossed.every((p) => p.mm < 30)).toBe(true);
    expect(r.crossed.some((p) => p.kind === 'funnel')).toBe(true);
  });

  it('returns null when the shell has not reached the ship within the step', () => {
    const { speed, angleDeg } = arrival(8000);
    const a = angleDeg * DEG;
    const r = traceShell(
      geom,
      rest,
      { massKg: shell.massKg, diameterMm: 305, speed },
      { origin: [0, 30, -80], dir: [0, -Math.sin(a), Math.cos(a)], segment: 10 },
    );
    expect(r).toBeNull();
  });

  it('long-range plunging fire gets through a deck that low-angle fire glances off', () => {
    // Descent angle is the whole story for a deck: at 10 km a 12-inch shell comes in at about 13 degrees.
    const low = arrival(10000).angleDeg;
    const high = rangeAtElevation(shell, 24 * DEG)!.angleDeg; // not reachable by the Dreadnought's own mounts
    expect(low).toBeLessThan(18);
    expect(high).toBeGreaterThan(25);
    const aim: V3 = [10, 5.5, 0];
    const vLow = arrival(10000).speed;
    const vHigh = rangeAtElevation(shell, 24 * DEG)!.speed;
    const deck = geom.plates.find((p) => p.kind === 'deck' && aim[0] >= p.lo[0] && aim[0] <= p.hi[0])!;
    const cosLow = Math.sin(low * DEG);
    const cosHigh = Math.sin(high * DEG);
    expect(throughPlate(vLow, 386, 305, deck.mm, cosLow).outcome).toBe('ricochet');
    expect(throughPlate(vHigh, 386, 305, deck.mm, cosHigh).outcome).toBe('penetrate');
  });
});

describe('penetration envelope', () => {
  it('shows where the Dreadnought\'s guns can hurt a pre-dreadnought: the belt only close, the casemates farther, the deck hardly ever', async () => {
    const { penetrationEnvelope } = await import('../src/sim/damage/envelope');
    const { PRE_DREADNOUGHT_DAMAGE } = await import('../src/data/ships/pre-dreadnought-damage');
    const env = penetrationEnvelope(shell, 13.5 * DEG, 10, PRE_DREADNOUGHT_DAMAGE.armor);
    const at = (r: number) => env.bands.find((b) => b.range === r)!;
    expect(env.reach).toBeGreaterThan(15000);
    expect(at(3000).belt).toBe(true);
    expect(at(3000).upper).toBe(true);
    expect(at(9000).belt).toBe(false);
    expect(at(9000).upper).toBe(true);
    expect(at(16000).upper).toBe(false);
    expect(at(8000).deck).toBe(false);
    // Nothing is defeated beyond what the gun can reach.
    const beyond = env.bands.filter((b) => b.range > env.reach);
    expect(beyond.every((b) => !b.belt && !b.upper && !b.deck)).toBe(true);
    // Each layer is defeated out to some range and no farther: the bands are monotone.
    for (const layer of ['belt', 'upper'] as const) {
      const first = env.bands.findIndex((b) => !b[layer]);
      expect(env.bands.slice(first).every((b) => !b[layer])).toBe(true);
    }
  });
});
