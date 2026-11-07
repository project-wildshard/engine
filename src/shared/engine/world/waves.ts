import * as waterWaves from '@wildshard/format/waterWaves';


/** Existing renderer/physics swell rows retain the same immutable format array. */
export const WAVES: readonly (readonly [number, number, number, number, number, number])[] = waterWaves.WAVES;

/** `t`: where the drawn surface stands. `stepped`: the fixed step's swell seconds, null until a player steps. A drawn sea takes
 *  that when it moves, so a swimmer stays on the water they see; in a menu or a capture, with nothing stepping, it runs on. */
export const waveClock: { t: number; stepped: number | null } = { t: 0, stepped: null };

/** Unbounded open water (the standalone level's sea runs to the horizon). */
export const WATER_UNBOUNDED = 1e9;
/**
 * The square half-extent (level metres, around the level's origin) the level's open water reaches: its swell body's rest
 * surface and any sea surface shader that reads `uWaterHalf` (a shared uniform, live). Unbounded unless a host confines it
 * (a level placed among others keeps its sea inside its own square).
 */
export const waterExtent: { uWaterHalf: { value: number; }; } = { uWaterHalf: { value: WATER_UNBOUNDED } };
/** The open water's rest surface reaches (x, z) (inside the confining square, or anywhere when unbounded). */
export function insideWaterExtent(x: number, z: number): boolean { return Math.max(Math.abs(x), Math.abs(z)) <= waterExtent.uWaterHalf.value; }

/** shore damping from the water depth (m): the swell flattens over the sand so the foam line stays put */
export function seaDamp(depth: number): number {
  const x = Math.min(1, Math.max(0, depth / 1.5));
  return 0.35 + 0.65 * x * x * (3 - 2 * x);
}

const TAU = Math.PI * 2;

/** Shared CPU/material-graph Gerstner coefficients, derived once from the immutable wave rows. */
export const GERSTNER_TERMS: readonly Readonly<{ x: number; z: number; amplitude: number; k: number; speed: number; horizontalX: number; horizontalZ: number; }>[] = Object.freeze(WAVES.map(([x, z, amplitude, length, speed, q]) => {
  const k = TAU / length, qa = (q / (k * amplitude * WAVES.length)) * amplitude;
  return Object.freeze({ x, z, amplitude, k, speed, horizontalX: x * qa, horizontalZ: z * qa });
}));

/** displacement (dx, dy, dz) of the surface point whose rest position is (x, z) */
export function waveDisplace(x: number, z: number, t: number, damp: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  let dx = 0, dy = 0, dz = 0;
  // an index loop: the destructuring for-of was garbage in every call (the boat, the floats, the foam — E186)
  for (let w = 0; w < GERSTNER_TERMS.length; w++) {
    const wave = GERSTNER_TERMS[w];
    if (wave === undefined) continue;
    const ph = wave.k * (wave.x * x + wave.z * z - wave.speed * t);
    const c = Math.cos(ph), sine = Math.sin(ph);
    dx += wave.horizontalX * c; dz += wave.horizontalZ * c; dy += wave.amplitude * sine;
  }
  out.x = dx * damp; out.y = dy * damp; out.z = dz * damp;
  return out;
}

const _o = { x: 0, y: 0, z: 0 };
/** surface height above the still level at world (x, z) — what a floating thing should ride */
export function waveHeight(x: number, z: number, t: number = waveClock.t, damp = 1): number {
  let px = x, pz = z;
  for (let i = 0; i < 2; i++) { waveDisplace(px, pz, t, damp, _o); px = x - _o.x; pz = z - _o.z; }
  return waveDisplace(px, pz, t, damp, _o).y;
}
