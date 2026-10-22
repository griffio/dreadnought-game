import { identityMat4, mulMat4, rotationZMat4, translationMat4, type Mat4 } from '../../math/mat4';

const DEG = Math.PI / 180;

/** How far below the surface a broken ship's halves are by the time the damage model calls her sunk, metres: past the highest tip. */
export const SUNK_DROP_M = 62;
/** The most each half is pitched about the break (its far end rising, the break going down), and rolled, radians. */
export const BREAK_PITCH = 30 * DEG;
export const BREAK_ROLL = 20 * DEG;
/** How quickly they get there, seconds, and how far the halves draw apart, metres. */
const SETTLE_SECONDS = 7;
const SEPARATION_M = 9;

/** Rotation about +x (the ship's length) by `angle`: positive turns +y toward +z. */
function rotationXMat4(angle: number, out: Mat4): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  identityMat4(out);
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

const T1 = new Float32Array(16);
const T2 = new Float32Array(16);
const A = new Float32Array(16);
const B = new Float32Array(16);

/**
 * How the two halves of a ship broken at ship-space `cutX` lie `age` seconds after she broke. `side` is +1 for the part forward of the
 * break (the bow) and -1 for the part aft (the stern). Each half is tipped about the break, its far end rising and the break itself
 * going down, rolled a little the other way to its partner's, drawn a few metres apart, and let down into the sea as `sunk` (0 as she
 * broke, 1 when she is declared sunk) goes from nothing to all of it. Returns a ship-space -> ship-space matrix to put after the pose.
 */
export function sectionMatrix(side: 1 | -1, cutX: number, age: number, sunk: number, out: Mat4): Mat4 {
  const a = Math.max(age, 0);
  const ease = 1 - Math.exp(-a / SETTLE_SECONDS);
  const pitch = side * BREAK_PITCH * ease;
  const roll = side * BREAK_ROLL * ease;
  const apart = side * SEPARATION_M * ease;
  const drop = SUNK_DROP_M * Math.min(Math.max(sunk, 0), 1.2);
  // out = T(cut + apart, -drop, 0) * Rx(roll) * Rz(pitch) * T(-cut)
  translationMat4(-cutX, 0, 0, T1);
  rotationZMat4(pitch, T2);
  mulMat4(T2, T1, A);
  rotationXMat4(roll, T2);
  mulMat4(T2, A, B);
  translationMat4(cutX + apart, -drop, 0, T1);
  return mulMat4(T1, B, out);
}

/** Where a ship-space point is carried by a half's matrix (for the fires and smoke that go with it). */
export function carry(m: Mat4, p: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}
