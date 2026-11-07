/** Numeric gust-front policy, passed by the world owner; no clock or shader state is read. */
export interface WindFieldSpec {
  readonly x: number; readonly z: number;
  readonly frontLength: number; readonly frontSpeed: number; readonly secondaryLength: number;
}

/** Slow clock gust with the weather's additive boost. Arithmetic matches the live uniform update. */
export function clockGust(time: number, boost: number): number {
  let gust = 0.5 + 0.28 * Math.sin(time * 0.11) + 0.16 * Math.sin(time * 0.37 + 1.3)
    + 0.08 * Math.sin(time * 1.3 + 0.4);
  if (boost > 0) gust += boost * (0.45 - 0.25 * gust);
  return Math.min(1, Math.max(0, gust));
}

/** Arithmetic adapter for the same gust-front law on CPU numbers and renderer nodes. */
export interface WindFieldMath<T> {
  readonly constant: (value: number) => T;
  readonly add: (a: T, b: T) => T;
  readonly sub: (a: T, b: T) => T;
  readonly mul: (a: T, b: T) => T;
  readonly div: (a: T, b: T) => T;
  readonly sin: (value: T) => T;
  readonly cos: (value: T) => T;
  readonly fract: (value: T) => T;
}
/** One renderer-free gust-front kernel; the world owns direction, front policy, time and gust. */
export function sampleWindField<T>(math: WindFieldMath<T>, x: T, z: T, time: T, gust: T, field: WindFieldSpec): T {
  const { constant: n, add, sub, mul, div, sin, cos, fract } = math;
  const front = (value: T): T => {
    const fraction = fract(value), warped = add(fraction, mul(n(0.12), sub(n(1), cos(mul(n(6.283185307), fraction)))));
    const cosine = add(n(0.5), mul(n(0.5), cos(mul(n(6.283185307), warped))));
    return mul(cosine, cosine);
  };
  const along = add(mul(x, n(field.x)), mul(z, n(field.z))), across = add(mul(x, n(-field.z)), mul(z, n(field.x)));
  const bend = add(mul(n(22), sin(add(mul(across, n(0.021)), mul(time, n(0.043))))), mul(n(9), sin(sub(mul(across, n(0.057)), mul(time, n(0.031))))));
  const distance = sub(add(along, bend), mul(time, n(field.frontSpeed)));
  const fronts = add(mul(n(0.75), front(div(distance, n(field.frontLength)))), mul(n(0.25), front(add(div(distance, n(field.secondaryLength)), n(0.37)))));
  const patchPhase = sub(add(mul(across, n(0.025)), mul(along, n(0.004))), mul(time, n(0.05)));
  const patchy = add(n(0.62), mul(n(0.38), sin(patchPhase)));
  return mul(add(n(0.3), mul(n(0.7), gust)), add(n(0.3), mul(mul(n(0.9), fronts), patchy)));
}
const numbers: WindFieldMath<number> = {
  constant: value => value, add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
  sin: Math.sin, cos: Math.cos, fract: value => value - Math.floor(value),
};
/** CPU sampler for projectile/sound laws, using explicit time and gust. */
export function fieldGustAt(x: number, z: number, time: number, gust: number, field: WindFieldSpec): number {
  return sampleWindField(numbers, x, z, time, gust, field);
}
