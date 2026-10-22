/** International Standard Atmosphere, troposphere only (the shells never leave it). Altitudes in metres. */
const T0 = 288.15;
const RHO0 = 1.225;
const LAPSE = 0.0065;

export function temperature(altitude: number): number {
  return T0 - LAPSE * Math.min(Math.max(altitude, 0), 11000);
}

const exactDensity = (altitude: number): number => RHO0 * Math.pow(temperature(altitude) / T0, 4.256);
const exactSound = (altitude: number): number => 20.05 * Math.sqrt(temperature(altitude));

// The integrator asks for these hundreds of thousands of times a second, so they are tabulated every 50 m and interpolated:
// the curves are smooth enough that the error is a few parts in a million.
const STEP = 50;
const SIZE = 400; // up to 20 km
const densityTable = new Float64Array(SIZE + 1);
const soundTable = new Float64Array(SIZE + 1);
for (let i = 0; i <= SIZE; i++) {
  densityTable[i] = exactDensity(i * STEP);
  soundTable[i] = exactSound(i * STEP);
}

function lookup(table: Float64Array, altitude: number): number {
  const f = Math.min(Math.max(altitude, 0), SIZE * STEP - 1) / STEP;
  const i = Math.floor(f);
  const t = f - i;
  return table[i]! * (1 - t) + table[i + 1]! * t;
}

/** Air density, kg/m^3. */
export function airDensity(altitude: number): number {
  return lookup(densityTable, altitude);
}

/** Speed of sound, m/s. */
export function speedOfSound(altitude: number): number {
  return lookup(soundTable, altitude);
}
