import { describe, expect, it } from 'vitest';
import { SightCamera } from '../src/app/sight-camera';
import { GamepadSource, type GamepadLike } from '../src/input/gamepad';
import { clearEdges, createIntent } from '../src/input/intent';
import { KeyboardSource } from '../src/input/keyboard-mouse';
import { PointerCameraSource } from '../src/input/pointer-camera';
import { Camera } from '../src/render/camera';
import { angleDelta, rudderForCourse } from '../src/sim/ships/autopilot';
import { battleshipHandling, KNOT, ShipDynamics } from '../src/sim/ships/dynamics';

const DEG = Math.PI / 180;

function fakeTarget() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, ...event });
    },
  };
}

describe('keyboard: fire control keys', () => {
  it('Q/E range, [ ] deflection, T auto-spot, B cease fire, V holds the sight, Space fires', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    for (const code of ['KeyQ', 'BracketRight', 'KeyT', 'KeyB']) t.fire('keydown', { code });
    t.fire('keydown', { code: 'KeyV' });
    t.fire('keydown', { code: 'Space' });
    expect(src.poll(out)).toBe(true);
    expect(out.rangeCorrect).toBe(-1);
    expect(out.deflectCorrect).toBe(1);
    expect(out.autoSpot).toBe(true);
    expect(out.ceaseFire).toBe(true);
    expect(out.sight).toBe(true);
    expect(out.fire).toBe(true);
    clearEdges(out);
    expect(out.autoSpot).toBe(false);
    t.fire('keyup', { code: 'KeyV' });
    t.fire('keyup', { code: 'Space' });
    out.sight = false;
    out.fire = false;
    src.poll(out);
    expect(out.sight).toBe(false);
    expect(out.fire).toBe(false);
  });

  it('Tab cycles forward and Shift+Tab backward', () => {
    const t = fakeTarget();
    const src = new KeyboardSource(t);
    const out = createIntent();
    t.fire('keydown', { code: 'Tab', shiftKey: false });
    src.poll(out);
    expect(out.cycleTarget).toBe(1);
    clearEdges(out);
    t.fire('keydown', { code: 'Tab', shiftKey: true });
    src.poll(out);
    expect(out.cycleTarget).toBe(-1);
  });
});

describe('pointer: tap designates, drag orbits, right button holds the sight', () => {
  const viewport = () => ({ width: 1000, height: 500 });
  const make = (type: 'mouse' | 'touch' = 'mouse') => {
    let now = 0;
    const t = fakeTarget();
    const src = new PointerCameraSource(type === 'mouse' ? 'keyboard-mouse' : 'touch', type, t, viewport, () => now);
    return { t, src, advance: (ms: number) => (now += ms) };
  };

  it('a quick press that barely moves designates at that point, in normalised device coordinates', () => {
    const { t, src, advance } = make();
    const out = createIntent();
    t.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 750, clientY: 125 });
    advance(120);
    t.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 750, clientY: 125 });
    expect(src.poll(out)).toBe(true);
    expect(out.designateNdc![0]).toBeCloseTo(0.5, 6);
    expect(out.designateNdc![1]).toBeCloseTo(0.5, 6);
    expect(out.cameraOrbit).toEqual([0, 0]);
  });

  it('a drag orbits instead, and a slow press is not a tap', () => {
    const a = make();
    const out = createIntent();
    a.t.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    a.t.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 100 });
    a.advance(100);
    a.t.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 160, clientY: 100 });
    a.src.poll(out);
    expect(out.designateNdc).toBeNull();
    expect(out.cameraOrbit[0]).toBeGreaterThan(5);

    const b = make();
    const out2 = createIntent();
    b.t.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    b.advance(900);
    b.t.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    b.src.poll(out2);
    expect(out2.designateNdc).toBeNull();
  });

  it('a pinch is never a tap', () => {
    const { t, src, advance } = make('touch');
    const out = createIntent();
    t.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 });
    t.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 200 });
    advance(100);
    t.fire('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 200 });
    t.fire('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 });
    src.poll(out);
    expect(out.designateNdc).toBeNull();
  });

  it('the right mouse button holds the sight up until released, and is not a designation', () => {
    const { t, src, advance } = make();
    const out = createIntent();
    t.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 10, clientY: 10 });
    expect(src.poll(out)).toBe(true);
    expect(out.sight).toBe(true);
    out.sight = false;
    advance(50);
    t.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 10, clientY: 10 });
    expect(src.poll(out)).toBe(false);
    expect(out.sight).toBe(false);
    expect(out.designateNdc).toBeNull();
  });
});

describe('gamepad: gunnery', () => {
  const pad = (over: { buttons?: Record<number, number>; axes?: number[] } = {}): GamepadLike => ({
    connected: true,
    axes: over.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (over.buttons?.[i] ?? 0) > 0.5, value: over.buttons?.[i] ?? 0 })),
  });

  it('RT fires, LT holds the sight, A toggles auto-spot', () => {
    let current = pad({ buttons: { 7: 1, 6: 1, 0: 1 } });
    let t = 0;
    const src = new GamepadSource(() => [current], () => t);
    const out = createIntent();
    src.poll(out);
    expect(out.fire).toBe(true);
    expect(out.sight).toBe(true);
    expect(out.autoSpot).toBe(true);
    // Held buttons: fire/sight are levels, auto-spot is an edge.
    clearEdges(out);
    out.fire = false;
    out.sight = false;
    t += 16;
    src.poll(out);
    expect(out.fire).toBe(true);
    expect(out.sight).toBe(true);
    expect(out.autoSpot).toBe(false);
    current = pad();
  });

  it('with the sight up the stick clicks zoom it; without, R3 cycles the camera', () => {
    let current = pad({ buttons: { 6: 1, 11: 1 } });
    const src = new GamepadSource(() => [current], () => 0);
    const out = createIntent();
    src.poll(out);
    expect(out.cameraZoom).toBe(1);
    expect(out.cycleCamera).toBe(false);
    current = pad();
    src.poll(out);
    current = pad({ buttons: { 11: 1 } });
    clearEdges(out);
    src.poll(out);
    expect(out.cycleCamera).toBe(true);
  });
});

describe('Camera projection', () => {
  const camera = new Camera();
  camera.position = [100, 30, 200];
  camera.yawDeg = 90; // looking east
  camera.pitchDeg = 0;
  camera.fovYDeg = 60;
  camera.update(16 / 9);

  it('a point straight ahead projects to the centre, and one to the right is right of centre', () => {
    const out: [number, number] = [0, 0];
    expect(camera.project(5100, 30, 200, out)).toBe(true);
    expect(out[0]).toBeCloseTo(0, 3);
    // Earth curvature drops a point 5 km away by about 2 m, which is a hair below the centre.
    expect(Math.abs(out[1])).toBeLessThan(0.01);
    expect(camera.project(5100, 30, 1200, out)).toBe(true); // +z is south: to the right when facing east
    expect(out[0]).toBeGreaterThan(0.05);
    expect(camera.project(5100, 30, -800, out)).toBe(true);
    expect(out[0]).toBeLessThan(-0.05);
  });

  it('a point behind the camera does not project', () => {
    const out: [number, number] = [0, 0];
    expect(camera.project(-500, 30, 200, out)).toBe(false);
  });

  it('rayThrough is the inverse of project', () => {
    const out: [number, number] = [0, 0];
    const ray = camera.rayThrough(0.4, -0.3);
    // A point 400 m along that ray lands back at (0.4, -0.3) (the Earth's curve is negligible this close).
    const p = [100 + ray[0] * 400, 30 + ray[1] * 400, 200 + ray[2] * 400] as const;
    expect(camera.project(p[0], p[1], p[2], out)).toBe(true);
    expect(out[0]).toBeCloseTo(0.4, 3);
    expect(out[1]).toBeCloseTo(-0.3, 3);
  });

  it('the curvature drop is applied: a point on the sea 12 km away sits visibly below the horizontal', () => {
    const level = new Camera();
    level.position = [0, 25, 0];
    level.yawDeg = 0;
    level.pitchDeg = 0;
    level.fovYDeg = 8;
    level.update(1);
    const out: [number, number] = [0, 0];
    level.project(0, 0, -12000, out);
    // Geometric: atan(25 / 12000) = 0.119 degrees below; curvature: (12000^2 / 12.74e6) = 11.3 m more. Total 36 m.
    const expected = -Math.atan(36.3 / 12000) / Math.atan(Math.tan(4 * DEG));
    expect(out[1]).toBeCloseTo(expected, 2);
  });
});

describe('SightCamera', () => {
  const anchor = [0, 25, 0] as const;

  it('takes the camera when engaged, zooms in, locks on a target, and gives the camera back', () => {
    const camera = new Camera();
    const sight = new SightCamera();
    const off = { engage: false, orbit: [0, 0] as const, zoom: 0 };
    expect(sight.update(0.016, camera, off, anchor, null, 0, 60)).toBe(false);
    expect(sight.fovDeg).toBe(60);

    const on = { engage: true, orbit: [0, 0] as const, zoom: 0 };
    let owned = false;
    for (let i = 0; i < 90; i++) owned = sight.update(0.016, camera, on, anchor, [8000, 9, -3000], 0, 60);
    expect(owned).toBe(true);
    expect(sight.fovDeg).toBeLessThan(11);
    expect(camera.position).toEqual([0, 25, 0]);
    // Locked on the target: east-north-east.
    expect(camera.yawDeg).toBeCloseTo((Math.atan2(8000, 3000) * 180) / Math.PI, 3);
    expect(camera.pitchDeg).toBeLessThan(0);

    // Zoom in two notches: the field narrows.
    const before = sight.fovDeg;
    sight.update(0.016, camera, { engage: true, orbit: [0, 0], zoom: 2 }, anchor, [8000, 9, -3000], 0, 60);
    for (let i = 0; i < 90; i++) sight.update(0.016, camera, on, anchor, [8000, 9, -3000], 0, 60);
    expect(sight.fovDeg).toBeLessThan(before * 0.6);

    // Release: it hands back once the field has widened again.
    let stillOwned = true;
    for (let i = 0; i < 200 && stillOwned; i++) stillOwned = sight.update(0.016, camera, off, anchor, [8000, 9, -3000], 0, 60);
    expect(stillOwned).toBe(false);
  });

  it('with no target it looks where it is turned: dragging right turns the view left, as a held world would', () => {
    const camera = new Camera();
    const sight = new SightCamera();
    sight.update(0.016, camera, { engage: true, orbit: [0, 0], zoom: 0 }, anchor, null, 90, 60);
    const yaw0 = camera.yawDeg;
    expect(yaw0).toBeCloseTo(90, 3);
    sight.update(0.016, camera, { engage: true, orbit: [30, 0], zoom: 0 }, anchor, null, 90, 60);
    expect(camera.yawDeg).toBeLessThan(yaw0);
  });

  it('remembers where it was aimed: the nudge off a target and the zoom survive letting the sight down and raising it again', () => {
    const camera = new Camera();
    const sight = new SightCamera();
    const on = { engage: true, orbit: [0, 0] as const, zoom: 0 };
    const off = { engage: false, orbit: [0, 0] as const, zoom: 0 };
    const target = [8000, 9, -3000] as const;
    const settle = (input: typeof on, n = 120, lock = 5) => {
      for (let i = 0; i < n; i++) sight.update(0.016, camera, input, anchor, target, 0, 60, lock);
    };
    settle(on);
    const centred = camera.yawDeg;
    // Pan the view off the target and zoom in.
    sight.update(0.016, camera, { engage: true, orbit: [-40, 25], zoom: 2 }, anchor, target, 0, 60, 5);
    settle(on);
    const nudgedYaw = camera.yawDeg;
    const nudgedPitch = camera.pitchDeg;
    const zoomed = sight.fovDeg;
    expect(nudgedYaw).toBeGreaterThan(centred + 0.1);

    // Down...
    for (let i = 0; i < 200; i++) sight.update(0.016, camera, off, anchor, target, 0, 60, 5);
    expect(sight.owns).toBe(false);
    // ...and up again: the same view, not a return to the middle.
    settle(on);
    expect(camera.yawDeg).toBeCloseTo(nudgedYaw, 3);
    expect(camera.pitchDeg).toBeCloseTo(nudgedPitch, 3);
    expect(sight.fovDeg).toBeCloseTo(zoomed, 1);

    // A different target starts from the target itself.
    settle(on, 5, 6);
    expect(camera.yawDeg).toBeCloseTo(centred, 3);
  });

  it('free look is remembered relative to the ship, so a turn of the ship in between does not lose it', () => {
    const camera = new Camera();
    const sight = new SightCamera();
    const on = { engage: true, orbit: [0, 0] as const, zoom: 0 };
    const off = { engage: false, orbit: [0, 0] as const, zoom: 0 };
    // Raise the sight with the ship heading 0 and turn the view 30 degrees to port... by dragging.
    sight.update(0.016, camera, on, anchor, null, 0, 60);
    for (let i = 0; i < 40; i++) sight.update(0.016, camera, { engage: true, orbit: [88, 0], zoom: 0 }, anchor, null, 0, 60);
    const relative = (((camera.yawDeg % 360) + 540) % 360) - 180;
    expect(Math.abs(relative)).toBeGreaterThan(3);
    for (let i = 0; i < 200; i++) sight.update(0.016, camera, off, anchor, null, 0, 60);
    // The ship has turned 90 degrees to starboard since; raise the sight again.
    sight.update(0.016, camera, on, anchor, null, 90, 60);
    const nowRelative = (((camera.yawDeg - 90) % 360) + 540) % 360 - 180;
    expect(nowRelative).toBeCloseTo(relative, 1);
  });

  it('survives a negative frame time', () => {
    const camera = new Camera();
    const sight = new SightCamera();
    sight.update(-0.2, camera, { engage: true, orbit: [0, 0], zoom: 0 }, anchor, null, 0, 60);
    expect(sight.fovDeg).toBeGreaterThan(1);
    expect(sight.fovDeg).toBeLessThanOrEqual(60);
  });
});

describe('autopilot', () => {
  it('steers a ship onto a new course without swinging far past it', () => {
    const d = new ShipDynamics(battleshipHandling(160, 21));
    d.heading = 0;
    d.setTelegraph(3);
    d.speed = d.orderedSpeed;
    const course = 110 * DEG;
    let worst = 0;
    for (let t = 0; t < 400; t += 1 / 60) {
      d.setRudderOrder(rudderForCourse(d, course));
      d.step(1 / 60);
      worst = Math.max(worst, angleDelta(course, d.heading)); // how far past the course it went (heading minus course)
    }
    expect(Math.abs(angleDelta(d.heading, course)) / DEG).toBeLessThan(1);
    expect(worst / DEG).toBeLessThan(8);
    expect(d.speed / KNOT).toBeGreaterThan(14);
  });

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(350 * DEG, 10 * DEG) / DEG).toBeCloseTo(20, 6);
    expect(angleDelta(10 * DEG, 350 * DEG) / DEG).toBeCloseTo(-20, 6);
  });
});
