export type InputDevice = 'keyboard-mouse' | 'gamepad' | 'touch';

export type Vec2 = readonly [number, number];

/** Engine-order telegraph positions, stern to bow. */
export const TELEGRAPH = {
  FULL_ASTERN: -3,
  HALF_ASTERN: -2,
  SLOW_ASTERN: -1,
  STOP: 0,
  SLOW_AHEAD: 1,
  HALF_AHEAD: 2,
  FULL_AHEAD: 3,
  FLANK: 4,
} as const;

export type ShellChoice = 'ap' | 'he' | 'star';

/**
 * What the player wants this frame, independent of device.
 *
 * "Level" fields are state held while the control is active. "Edge" fields are one-frame events and are
 * reset by `clearEdges` once the sim has consumed them. Absolute-vs-rate pairs let a touch wheel set the
 * rudder directly while a keyboard nudges it.
 */
export interface Intent {
  /** Absolute rudder demand, -1 (port) to 1 (starboard); null when the device is not setting it. */
  helmSet: number | null;
  /** Rudder rate demand in wheel-turns per second, -1 to 1. */
  helmRate: number;
  /** Absolute telegraph position (a touch lever); null when unset. */
  telegraphSet: number | null;
  /** Edge (accumulated): steps to move the telegraph, positive = more ahead. */
  telegraphStep: number;

  /** Aim point as a pointer position in NDC (-1..1); null when the device aims with a stick. */
  aimNdc: Vec2 | null;
  /** Aim/camera stick rate, -1..1 per axis. */
  aimRate: Vec2;
  /** Zoom rate (binoculars/director sight), -1..1. */
  zoomRate: number;
  /** Level: director sight / binoculars held. */
  sight: boolean;
  /** Edge (accumulated): camera orbit this frame in degrees, [yaw (+ right), pitch (+ up)]. */
  cameraOrbit: Vec2;
  /** Edge (accumulated): camera zoom in notches this frame, positive zooms in. */
  cameraZoom: number;

  /** Level: main battery trigger held. */
  fire: boolean;
  /** Edge: stop firing now. */
  ceaseFire: boolean;
  /** Edge: pointer designation of a target at this NDC position. */
  designateNdc: Vec2 | null;
  /** Edge: cycle targets. */
  cycleTarget: -1 | 0 | 1;

  /** Edge (accumulated): fire-control correction steps this frame, +100 m of range and +10 m to the right per step. */
  rangeCorrect: number;
  deflectCorrect: number;
  /** Edge: toggle the auto-spotter (the gunnery officer applies the corrections himself). */
  autoSpot: boolean;
  /** Edge: pick a shell type. */
  shell: ShellChoice | null;
  /** Edge: change to the other shell (armour-piercing and high-explosive). */
  cycleShell: boolean;

  /** Edge: toggles. */
  torpedoMode: boolean;
  cycleCamera: boolean;
  /** Edge: review the last of the fight (the replay). */
  replay: boolean;
  togglePlot: boolean;
  toggleDamageView: boolean;
  smoke: boolean;
  /** Edge: put the spotter aircraft up, or call it home. */
  spotter: boolean;
  pause: boolean;
}

export function createIntent(): Intent {
  return {
    helmSet: null,
    helmRate: 0,
    telegraphSet: null,
    telegraphStep: 0,
    aimNdc: null,
    aimRate: [0, 0],
    zoomRate: 0,
    sight: false,
    cameraOrbit: [0, 0],
    cameraZoom: 0,
    fire: false,
    ceaseFire: false,
    designateNdc: null,
    cycleTarget: 0,
    rangeCorrect: 0,
    deflectCorrect: 0,
    autoSpot: false,
    shell: null,
    cycleShell: false,
    torpedoMode: false,
    cycleCamera: false,
    replay: false,
    togglePlot: false,
    toggleDamageView: false,
    smoke: false,
    spotter: false,
    pause: false,
  };
}

/** Zero the held "level" fields. The manager does this before polling so idle devices cannot clobber active ones. */
export function resetLevels(i: Intent): void {
  i.helmRate = 0;
  i.aimRate = [0, 0];
  i.zoomRate = 0;
  i.sight = false;
  i.fire = false;
}

/** Reset the one-frame events, once the sim has consumed them. Held "level" state is reset by `resetLevels`. */
export function clearEdges(i: Intent): void {
  i.telegraphStep = 0;
  i.telegraphSet = null;
  i.cameraOrbit = [0, 0];
  i.cameraZoom = 0;
  i.helmSet = null;
  i.ceaseFire = false;
  i.designateNdc = null;
  i.cycleTarget = 0;
  i.rangeCorrect = 0;
  i.deflectCorrect = 0;
  i.autoSpot = false;
  i.shell = null;
  i.cycleShell = false;
  i.torpedoMode = false;
  i.cycleCamera = false;
  i.replay = false;
  i.togglePlot = false;
  i.toggleDamageView = false;
  i.smoke = false;
  i.spotter = false;
  i.pause = false;
}
