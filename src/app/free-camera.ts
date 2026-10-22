import type { Camera } from '../render/camera';
import { degToRad } from '../math/vec3';

const LOOK_DEG_PER_PX = 0.16;
const MOVE_SPEED = 40; // m/s, doubled with Shift
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 600;

/**
 * Showcase camera: drag to look, WASD/QE or two-finger pinch to move. Temporary: the game's own camera and
 * input arrive with the helm (M3).
 */
export class FreeCamera {
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;

  constructor(
    private readonly camera: Camera,
    private readonly element: HTMLElement,
  ) {
    element.addEventListener('pointerdown', (e) => {
      element.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchDistance = this.currentPinch();
    });
    element.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        camera.yawDeg += dx * LOOK_DEG_PER_PX;
        camera.pitchDeg = Math.min(Math.max(camera.pitchDeg - dy * LOOK_DEG_PER_PX, -85), 85);
      } else if (this.pointers.size === 2) {
        const d = this.currentPinch();
        this.move(0, (d - this.pinchDistance) * 0.6, 0);
        this.pinchDistance = d;
      }
    });
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinchDistance = this.currentPinch();
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.move(0, -e.deltaY * 0.05, 0);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private currentPinch(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }

  /** Move relative to the heading: forward/back along the horizontal view direction, right, and up. */
  private move(right: number, forward: number, up: number): void {
    const yaw = degToRad(this.camera.yawDeg);
    const p = this.camera.position;
    p[0] += Math.sin(yaw) * forward + Math.cos(yaw) * right;
    p[2] += -Math.cos(yaw) * forward + Math.sin(yaw) * right;
    p[1] = Math.min(Math.max(p[1] + up, MIN_HEIGHT), MAX_HEIGHT);
  }

  update(dt: number): void {
    const k = this.keys;
    const speed = MOVE_SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.5 : 1) * dt;
    const axis = (pos: string, neg: string) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    this.move(axis('KeyD', 'KeyA') * speed, axis('KeyW', 'KeyS') * speed, axis('KeyE', 'KeyQ') * speed);
    this.camera.yawDeg += axis('ArrowRight', 'ArrowLeft') * 60 * dt;
    this.camera.pitchDeg = Math.min(Math.max(this.camera.pitchDeg + axis('ArrowUp', 'ArrowDown') * 40 * dt, -85), 85);
  }
}
