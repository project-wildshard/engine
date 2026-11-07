// The simulation's transcendental Math: pure JS over + - * / and sqrt, so an iPhone, a Mac and a Linux server compute the same
// bits. Native Math.sin / cos / tan / exp / log / atan / atan2 / asin / acos / pow round differently on arm64 (fused multiply-add
// in V8's compiled C++) and x64, and pow differs by libc too; JavaScriptCore has its own again. One rounded bit in a long tape
// grows into a different branch: the Nalati chapter's bond took 8,947 ticks on Linux and about 3,494 on a Mac.
//
// Everything that steps the sim runs on these, from its first module on: the page (entry.ts), the worker, a tick worker, a room
// and a client on the wire. A baker does not: its output is pinned, and it keeps @wildshard/commons/bake/portableMath, this
// table's twin (test/portable-math.test.ts holds them together), or native math where its bytes were recorded with it.
//
// Identical on V8 arm64, V8 x64 and JavaScriptCore over 1M inputs per function. `**` never reaches these: a sim file writes
// Math.pow, or a square, or a power of two, which round the same everywhere (same test). sin, cos and tan beyond 2^28 radians
// still defer to the native function.

/** Math.hypot is free to round as an engine likes, and JavaScriptCore's isn't V8's. This is V8's own (Kahan summation over the
 *  largest term), so V8 keeps its bits. */
function hypot(...values: number[]): number {
  let max = 0, nan = false;
  for (const value of values) {
    const size = Math.abs(value);
    if (Number.isNaN(size)) nan = true;
    else if (size > max) max = size;
  }
  if (max === Infinity) return Infinity;
  if (nan) return Number.NaN;
  if (max === 0) return 0;
  let sum = 0, compensation = 0;
  for (const value of values) {
    const n = Math.abs(value) / max, summand = n * n - compensation, preliminary = sum + summand;
    compensation = (preliminary - sum) - summand;
    sum = preliminary;
  }
  return Math.sqrt(sum) * max;
}

// captured before any install, so a special value can defer to the native function
const nativeSin = Math.sin, nativeCos = Math.cos, nativeTan = Math.tan, nativeExp = Math.exp, nativeLog = Math.log;
const nativeAtan = Math.atan, nativeAtan2 = Math.atan2, nativeAsin = Math.asin, nativeAcos = Math.acos, nativePow = Math.pow;

const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const INV_PIO2 = 6.36619772367581382433e-01;
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const PI = 3.14159265358979311600e+00, PI_LO = 1.2246467991473532e-16;

const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
const f64 = (): number => bits[0] ?? Number.NaN;
/** 2^k exactly, for k in [-1022, 1023] (built from the exponent bits, no pow) */
function pow2(k: number): number {
  words[0] = 0; words[1] = ((k + 1023) << 20) >>> 0;
  return f64();
}
/** x * 2^k without overflowing the intermediate */
function scale(x: number, k: number): number {
  let y = x, n = k;
  while (n > 1023) { y *= pow2(1023); n -= 1023; }
  while (n < -1022) { y *= pow2(-1022); n += 1022; }
  return y * pow2(n);
}

/** fdlibm __kernel_sin / __kernel_cos on |r| <= pi/4 (r = hi + lo) */
function kSin(x: number, y: number): number {
  const z = x * x, v = z * x;
  const r = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)));
  return x - ((z * (0.5 * y - v * r) - y) - v * -1.66666666666666324348e-01);
}
function kCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}
/** x = n * pi/2 + (hi + lo): Cody–Waite reduction (fdlibm's first step, and its second for larger n) */
function reduced(x: number): [number, number, number] {
  const n = Math.round(x * INV_PIO2);
  const r0 = x - n * PIO2_1, w0 = n * PIO2_1T;
  const y0 = r0 - w0;
  if (Math.abs(n) < 32) return [n, y0, (r0 - y0) - w0];
  // a second pass for larger n (fdlibm's 2nd iteration)
  const t = r0, w = n * PIO2_2, r = t - w, w2 = n * PIO2_2T - ((t - r) - w);
  const y = r - w2;
  return [n, y, (r - y) - w2];
}
function sin(x: number): number {
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 268435456) return nativeSin(x);
  if (Math.abs(x) <= Math.PI / 4) return kSin(x, 0);
  const [n, hi, lo] = reduced(x);
  switch (((n % 4) + 4) % 4) {
    case 0: return kSin(hi, lo);
    case 1: return kCos(hi, lo);
    case 2: return -kSin(hi, lo);
    default: return -kCos(hi, lo);
  }
}
function cos(x: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 268435456) return nativeCos(x);
  if (Math.abs(x) <= Math.PI / 4) return kCos(x, 0);
  const [n, hi, lo] = reduced(x);
  switch (((n % 4) + 4) % 4) {
    case 0: return kCos(hi, lo);
    case 1: return -kSin(hi, lo);
    case 2: return -kCos(hi, lo);
    default: return kSin(hi, lo);
  }
}
function tan(x: number): number {
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 268435456) return nativeTan(x);
  return sin(x) / cos(x);
}

function exp(x: number): number {
  if (!Number.isFinite(x) || x === 0 || x > 709.78 || x < -745.14) return nativeExp(x);
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo;
  // e^r on |r| <= ln2 / 2, Taylor to r^22 (relative error < 1e-20)
  let term = 1, sum = 1;
  for (let i = 1; i <= 22; i++) { term = term * r / i; sum += term; }
  return scale(sum, k);
}

function log(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return nativeLog(x);
  bits[0] = x;
  let k = ((words[1] ?? 0) >>> 20) - 1023, m: number;
  if (k === -1023) { // subnormal: renormalise
    const y = x * pow2(54); bits[0] = y; k = ((words[1] ?? 0) >>> 20) - 1023 - 54;
  }
  words[1] = ((words[1] ?? 0) & 0x000fffff) | 0x3ff00000;
  m = f64(); // m in [1, 2)
  if (m > Math.SQRT2) { m /= 2; k += 1; }
  // log m = 2 atanh(s), s = (m - 1) / (m + 1), |s| <= 0.1716
  const s = (m - 1) / (m + 1), s2 = s * s;
  let term = s, sum = 0;
  for (let i = 1; i <= 41; i += 2) { sum += term / i; term *= s2; }
  return k * LN2_HI + (2 * sum + k * LN2_LO);
}

/** atan on any finite x: three half-angle reductions, then the series on |t| <= tan(pi/32) */
function atan(x: number): number {
  if (!Number.isFinite(x) || x === 0) return nativeAtan(x);
  const neg = x < 0, a = neg ? -x : x;
  let t: number, base = 0;
  if (a > 1) { t = 1 / a; base = Math.PI / 2; } else t = a;
  for (let i = 0; i < 3; i++) t /= 1 + Math.sqrt(1 + t * t);
  const t2 = t * t;
  let term = t, sum = 0;
  for (let i = 1; i <= 27; i += 2) { sum += (((i - 1) / 2) % 2 === 0 ? term : -term) / i; term *= t2; }
  const small = 8 * sum, r = base === 0 ? small : (base - small) + 6.123233995736766e-17;
  return neg ? -r : r;
}
function atan2(y: number, x: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return nativeAtan2(y, x);
  if (x > 0) return atan(y / x);
  const r = atan(y / x);
  return y >= 0 ? (r + PI) + PI_LO : (r - PI) - PI_LO;
}
function asin(x: number): number {
  if (!(Math.abs(x) < 1) || x === 0) return nativeAsin(x);
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}
function acos(x: number): number {
  if (!(Math.abs(x) < 1)) return nativeAcos(x);
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

function pow(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0 || a === 1) return nativePow(a, b);
  if (Number.isInteger(b) && Math.abs(b) <= 64) {
    let base = a, n = Math.abs(b), out = 1;
    while (n > 0) { if (n % 2 === 1) out *= base; base *= base; n = Math.floor(n / 2); }
    return b < 0 ? 1 / out : out;
  }
  if (a < 0) {
    if (!Number.isInteger(b)) return Number.NaN;
    const r = exp(b * log(-a));
    return b % 2 === 0 ? r : -r;
  }
  return exp(b * log(a));
}

const PORTABLE: {
  readonly sin: typeof sin;
  readonly cos: typeof cos;
  readonly tan: typeof tan;
  readonly exp: typeof exp;
  readonly log: typeof log;
  readonly atan: typeof atan;
  readonly atan2: typeof atan2;
  readonly asin: typeof asin;
  readonly acos: typeof acos;
  readonly pow: typeof pow;
} = { sin, cos, tan, exp, log, atan, atan2, asin, acos, pow };

const SIM_MATH: typeof PORTABLE & { readonly hypot: typeof hypot } = { ...PORTABLE, hypot };

/** Put the portable functions on the global Math. Idempotent, and there is no undo: a realm that steps the sim stays on them. */
export function installPortableMath(): void {
  for (const [name, fn] of Object.entries(SIM_MATH)) Reflect.set(Math, name, fn);
}

/** Whether this realm's Math is the portable one. */
export const portableMathInstalled = (): boolean => Object.entries(SIM_MATH).every(([name, fn]) => Reflect.get(Math, name) === fn);

/** The portable functions, for a proof that compares them to something. */
export const portableMath: typeof SIM_MATH = SIM_MATH;
