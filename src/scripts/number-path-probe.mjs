// Failure diagnostics for Node/V8 number paths, captured before portable Math installation.
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** @param {number} value */
function bits(value) {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  return bytes.getBigUint64(0).toString(16).padStart(16, '0');
}

/** @type {ReturnType<typeof captureNumberPathProbe> | undefined} */
let captured;

/** Fixed, bounded native Math and exact JSON round-trip samples; no gameplay state is changed. */
export function captureNumberPathProbe() {
  const values = [-0, 0, Number.MIN_VALUE, Number.MAX_VALUE, Number.EPSILON,
    0.1, -0.1, 1 / 3, Math.PI, 1e-12, 1e21, 9007199254740991];
  const bytes = new DataView(new ArrayBuffer(8)), mask = (1n << 64n) - 1n;
  let seed = 0x6a09e667f3bcc909n;
  for (let i = 0; i < 128; i++) {
    seed = (seed ^ (seed << 13n)) & mask;
    seed ^= seed >> 7n;
    seed = (seed ^ (seed << 17n)) & mask;
    bytes.setBigUint64(0, seed);
    const value = bytes.getFloat64(0);
    if (Number.isFinite(value)) values.push(value);
  }
  const json = values.map(value => {
    const wire = JSON.stringify(value);
    /** @type {unknown} */
    const after = JSON.parse(wire);
    return { bits: bits(value), wire, afterBits: typeof after === 'number' ? bits(after) : null,
      sameValue: Object.is(value, after) };
  });
  const inputs = [-1, -0, 0, 1e-12, 0.1, 0.7, 1, Math.PI, 20, 1000000];
  const unary = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
    log: Math.log, atan: Math.atan, asin: Math.asin, acos: Math.acos, sqrt: Math.sqrt };
  const math = Object.entries(unary).flatMap(([op, fn]) => inputs.map(value => ({ op, args: [value], argBits: [bits(value)], bits: bits(fn(value)) })));
  /** @type {[number, number][]} */
  const pairs = [[0.1, 0.7], [-0, -1], [2, 0.5], [0.7, 1.3]];
  const binary = { atan2: Math.atan2, pow: Math.pow };
  for (const [op, fn] of Object.entries(binary)) {
    for (const [a, b] of pairs) math.push({ op, args: [a, b], argBits: [bits(a), bits(b)], bits: bits(fn(a, b)) });
  }
  const result = { runtime: { node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch }, json, math };
  captured = result;
  return result;
}

/** Return only an explicitly captured pre-install probe; never invoke native Math after installation. */
export function capturedNumberPathProbe() { return captured; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.info(JSON.stringify(captureNumberPathProbe(), null, 2));
}
