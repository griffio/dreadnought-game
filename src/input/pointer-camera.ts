import type { InputDevice, Intent } from './intent';
import type { InputSource } from './manager';

type Listener = (e: any) => void;
interface Events {
  addEventListener(type: string, fn: Listener, options?: unknown): void;
}

const ORBIT_DEGREES_PER_PIXEL = 0.22;
/** Pinch distance (px) that counts as one zoom notch. */
const PINCH_PIXELS_PER_NOTCH = 45;
/** Wheel delta (px) that counts as one zoom notch. */
const WHEEL_PIXELS_PER_NOTCH = 90;
/** A press shorter than this and moving less than this is a tap (designate), not a drag (orbit). */
const TAP_MAX_MS = 350;
const TAP_MAX_PIXELS = 10;

/**
 * Drag-to-orbit and pinch/wheel-to-zoom on the game canvas, for one kind of pointer. Instantiate once for the
 * mouse (reported as keyboard-mouse) and once for fingers (reported as touch). A quick press that barely moves is a
 * tap: it designates whatever is under it. The mouse's right button holds the director's sight up.
 */
export class PointerCameraSource implements InputSource {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private orbit: [number, number] = [0, 0];
  private zoom = 0;
  private pinchDistance = 0;
  private pinchRemainder = 0;
  private wheelRemainder = 0;
  private tap: { x: number; y: number; t: number; travel: number; multi: boolean } | null = null;
  private designate: [number, number] | null = null;
  private sightHeld = false;

  constructor(
    readonly device: InputDevice,
    private readonly pointerType: 'mouse' | 'touch',
    target: Events,
    private readonly viewport: () => { width: number; height: number } = () => ({
      width: typeof window === 'undefined' ? 1 : window.innerWidth,
      height: typeof window === 'undefined' ? 1 : window.innerHeight,
    }),
    private readonly clock: () => number = () => performance.now(),
  ) {
    if (pointerType === 'mouse') target.addEventListener('contextmenu', (e) => e.preventDefault?.());
    target.addEventListener('pointerdown', (e) => {
      if (!this.matches(e)) return;
      if (pointerType === 'mouse' && e.button === 2) {
        this.sightHeld = true;
        (e.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
        return;
      }
      if (pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
      if (this.pointers.size === 0) this.tap = { x: e.clientX, y: e.clientY, t: this.clock(), travel: 0, multi: false };
      else if (this.tap) this.tap.multi = true;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchDistance = this.currentPinch();
      this.pinchRemainder = 0;
      (e.target as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.tap) this.tap.travel = Math.max(this.tap.travel, Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y));
      if (this.pointers.size === 1) {
        this.orbit[0] += dx * ORBIT_DEGREES_PER_PIXEL;
        this.orbit[1] += dy * ORBIT_DEGREES_PER_PIXEL; // dragging down lifts the camera
      } else if (this.pointers.size === 2) {
        const d = this.currentPinch();
        this.pinchRemainder += d - this.pinchDistance;
        this.pinchDistance = d;
        const notches = Math.trunc(this.pinchRemainder / PINCH_PIXELS_PER_NOTCH);
        if (notches !== 0) {
          this.zoom += notches;
          this.pinchRemainder -= notches * PINCH_PIXELS_PER_NOTCH;
        }
      }
    });
    const release = (e: { pointerId: number; button?: number; type?: string }) => {
      if (pointerType === 'mouse' && e.button === 2) {
        this.sightHeld = false;
        return;
      }
      const wasTracked = this.pointers.delete(e.pointerId);
      this.pinchDistance = this.currentPinch();
      const tap = this.tap;
      if (wasTracked && tap && this.pointers.size === 0) {
        this.tap = null;
        const quick = this.clock() - tap.t <= TAP_MAX_MS;
        if (e.type !== 'pointercancel' && !tap.multi && quick && tap.travel <= TAP_MAX_PIXELS) {
          const v = this.viewport();
          this.designate = [(tap.x / v.width) * 2 - 1, 1 - (tap.y / v.height) * 2];
        }
      }
    };
    // Read the fields explicitly: the properties of a real PointerEvent live on its prototype and do not survive a spread.
    target.addEventListener('pointerup', (e) => release({ pointerId: e.pointerId, button: e.button, type: 'pointerup' }));
    target.addEventListener('pointercancel', (e) => release({ pointerId: e.pointerId, button: e.button, type: 'pointercancel' }));
    if (pointerType === 'mouse') {
      target.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault?.();
          this.wheelRemainder -= e.deltaY;
          const notches = Math.trunc(this.wheelRemainder / WHEEL_PIXELS_PER_NOTCH);
          if (notches !== 0) {
            this.zoom += notches;
            this.wheelRemainder -= notches * WHEEL_PIXELS_PER_NOTCH;
          }
        },
        { passive: false },
      );
    }
  }

  private matches(e: { pointerType?: string }): boolean {
    return (e.pointerType ?? 'mouse') === this.pointerType || (this.pointerType === 'touch' && e.pointerType === 'pen');
  }

  private currentPinch(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }

  poll(out: Intent): boolean {
    let active = this.orbit[0] !== 0 || this.orbit[1] !== 0 || this.zoom !== 0;
    if (this.designate) {
      out.designateNdc = this.designate;
      this.designate = null;
      active = true;
    }
    if (this.sightHeld) {
      out.sight = true;
      active = true;
    }
    if (this.orbit[0] !== 0 || this.orbit[1] !== 0 || this.zoom !== 0) {
      out.cameraOrbit = [out.cameraOrbit[0] + this.orbit[0], out.cameraOrbit[1] + this.orbit[1]];
      out.cameraZoom += this.zoom;
    }
    this.orbit = [0, 0];
    this.zoom = 0;
    return active;
  }
}
