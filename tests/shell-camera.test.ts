import { describe, expect, it } from 'vitest';
import { ReplayCamera, ShellCamera, timeToSea } from '../src/app/shell-camera';
import type { ShellShot } from '../src/app/replay';

/** A shell flying east (+x) and coming down at `descent` m/s, from the given point. */
const shell = (id: number, x: number, y: number, vy = -40, vx = 600): ShellShot => ({ id, x, y, z: 0, vx, vy, vz: 0 });

describe('timeToSea', () => {
  it('is the time a free-falling shell takes to come down', () => {
    // From 100 m, descending at 150 m/s, it is down in about two thirds of a second.
    expect(timeToSea(100, -150)).toBeCloseTo(0.65, 1);
    // Thrown up from the sea it is up and down again in 2v/g.
    expect(timeToSea(0, 98.1)).toBeCloseTo(20, 1);
    expect(timeToSea(0, -50)).toBeCloseTo(0, 6);
  });
});

describe('the shell camera', () => {
  it('has nothing to say until it is asked to begin, and begins only if there is a shell to ride', () => {
    const cam = new ShellCamera();
    expect(cam.update(0.016, [shell(1, 0, 500)])).toBeNull();
    expect(cam.begin([])).toBe(false);
    expect(cam.active).toBe(false);
    expect(cam.begin([shell(1, 0, 500)])).toBe(true);
    expect(cam.active).toBe(true);
  });

  it('rides the newest shell from behind and a little above, looking ahead along its flight', () => {
    const cam = new ShellCamera();
    cam.begin([shell(1, 0, 500), shell(7, 100, 400)]);
    expect(cam.riding).toBe(7);
    const shot = cam.update(0.016, [shell(1, 0, 500), shell(7, 100, 400)])!;
    // The shell is at x=100 flying east: the camera is west of it, above it, and the look point east of it.
    expect(shot.position[0]).toBeLessThan(100 - 40);
    expect(shot.position[1]).toBeGreaterThan(400);
    expect(shot.look[0]).toBeGreaterThan(100);
    expect(shot.fovDeg).toBeGreaterThan(30);
  });

  it('follows the shell as it flies, easing rather than jumping', () => {
    const cam = new ShellCamera();
    const s = shell(2, 0, 400);
    cam.begin([s]);
    const a = cam.update(0.016, [s])!;
    const moved = shell(2, 600, 360);
    const b = cam.update(0.016, [moved])!;
    // After one frame it has moved toward the new place, but not all the way.
    expect(b.position[0]).toBeGreaterThan(a.position[0]);
    expect(b.position[0]).toBeLessThan(600 - 70);
    for (let i = 0; i < 120; i++) cam.update(0.016, [moved]);
    const settled = cam.update(0.016, [moved])!;
    expect(settled.position[0]).toBeCloseTo(600 - 70, -1);
  });

  it('runs the game at full speed until the last seconds of the flight, then slows it, and the splash is slow too', () => {
    const cam = new ShellCamera();
    cam.begin([shell(3, 0, 800, -100)]);
    cam.update(0.016, [shell(3, 0, 800, -100)]);
    expect(cam.timeScale).toBe(1);
    // About a second and a half from the sea.
    cam.update(0.016, [shell(3, 5000, 60, -80)]);
    expect(cam.timeScale).toBeLessThan(0.8);
    expect(cam.timeScale).toBeGreaterThanOrEqual(0.3);
    // Nearly down.
    cam.update(0.016, [shell(3, 5100, 4, -80)]);
    expect(cam.timeScale).toBeCloseTo(0.3, 1);
  });

  it('holds where it is and looks at the splash when the shell lands, then lets go and gives the game its speed back', () => {
    const cam = new ShellCamera();
    cam.begin([shell(4, 0, 300)]);
    cam.update(0.016, [shell(4, 4000, 20, -80)]);
    const before = cam.update(0.016, [shell(4, 4100, 5, -80)])!;
    // It is gone from the list: it has landed.
    const dwelling = cam.update(0.016, [])!;
    expect(cam.state).toBe('dwell');
    expect(dwelling.position[0]).toBeCloseTo(before.position[0], 3);
    expect(cam.timeScale).toBeCloseTo(0.3, 1);
    // It looks toward the last place the shell was seen.
    for (let i = 0; i < 40; i++) cam.update(0.016, []);
    const looking = cam.update(0.016, [])!;
    expect(looking.look[0]).toBeGreaterThan(4000);
    // About two seconds of the player's time on the splash: then it is done, idle, and the game is at full speed again.
    let frames = 42;
    while (cam.active && frames < 2000) {
      cam.update(0.016, []);
      frames++;
    }
    expect(cam.active).toBe(false);
    expect(cam.timeScale).toBe(1);
    expect(frames * 0.016).toBeGreaterThan(1.5);
    expect(frames * 0.016).toBeLessThan(2.3);
    expect(cam.update(0.016, [])).toBeNull();
  });

  it('can be cancelled at once', () => {
    const cam = new ShellCamera();
    cam.begin([shell(5, 0, 300)]);
    cam.update(0.016, [shell(5, 4000, 20, -80)]);
    cam.cancel();
    expect(cam.active).toBe(false);
    expect(cam.timeScale).toBe(1);
    expect(cam.update(0.016, [shell(5, 4000, 20, -80)])).toBeNull();
  });
});

describe('the replay camera', () => {
  const ships = [
    { x: 0, z: 0, headingDeg: 0 },
    { x: 6000, z: -1000, headingDeg: 180 },
  ];

  it('rides each salvo once in auto, and circles her own ship between them', () => {
    const cam = new ReplayCamera();
    expect(cam.mode).toBe('auto');
    // No shells: an orbit about her own ship, close and a little above it.
    const idle = cam.update(0.016, ships, []);
    expect(idle.position[1]).toBeGreaterThan(30);
    expect(Math.hypot(idle.position[0], idle.position[2])).toBeLessThan(300);
    expect(idle.look[0]).toBeCloseTo(0, 0);
    // A salvo goes up: the camera rides it.
    const up = [shell(10, 100, 300)];
    const riding = cam.update(0.016, ships, up);
    expect(riding.position[0]).toBeLessThan(100);
    expect(riding.fovDeg).toBeLessThan(60);
    // When it lands the camera dwells, then goes back to the orbit; the same shell is not ridden again.
    cam.update(0.016, ships, []);
    for (let i = 0; i < 3000; i++) cam.update(0.016, ships, []);
    expect(cam.timeScale).toBe(1);
    const after = cam.update(0.016, ships, [shell(10, 100, 300)]);
    expect(after.fovDeg).toBe(60);
    // A new salvo is ridden.
    const next = cam.update(0.016, ships, [shell(11, 150, 300)]);
    expect(next.fovDeg).toBeLessThan(60);
  });

  it('does not ride shells in the other modes: the ship and the target each have their own orbit', () => {
    const cam = new ReplayCamera();
    cam.setMode('ship');
    const close = cam.update(0.016, ships, [shell(20, 100, 300)]);
    expect(close.fovDeg).toBe(60);
    expect(Math.hypot(close.position[0] - 0, close.position[2] - 0)).toBeLessThan(300);
    expect(close.look[0]).toBeCloseTo(0, 0);
    cam.setMode('target');
    const foe = cam.update(0.016, ships, []);
    // A new mode is taken up at once, not eased to from where the last one was.
    expect(Math.hypot(foe.position[0] - 6000, foe.position[2] + 1000)).toBeLessThan(400);
    expect(foe.look[0]).toBeCloseTo(6000, 0);
  });
});
