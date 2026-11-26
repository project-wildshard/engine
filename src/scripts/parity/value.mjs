/** @typedef {null | boolean | number | string | Value[] | {[key: string]: Value | undefined}} Value */
/** @typedef {Record<string, Value | undefined>} RecordValue */
/** @param {unknown} value @returns {RecordValue} */
export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? /** @type {RecordValue} */ (value) : {};
}
/** @param {unknown} value @returns {Value[]} */
export function array(value) { return Array.isArray(value) ? /** @type {Value[]} */ (value) : []; }
/** @param {unknown} value @returns {number} */
export function number(value) { return typeof value === 'number' ? value : Number.NaN; }
/** @param {unknown} value @returns {string} */
export function string(value) { return typeof value === 'string' ? value : ''; }
/** @param {unknown} value @param {string} path @returns {Value | undefined} */
export function get(value, path) {
  let v = value;
  for (const part of path.split('../parity')) v = object(v)[part];
  return /** @type {Value | undefined} */ (v);
}
/** @param {RecordValue} value @param {string} path @param {Value} next */
export function set(value, path, next) {
  const parts = path.split('../parity'); const last = parts.pop();
  if (!last) throw new Error('empty field path');
  let v = value;
  for (const p of parts) { if (!v[p] || typeof v[p] !== 'object' || Array.isArray(v[p])) v[p] = {}; v = object(v[p]); }
  v[last] = next;
}
/** @param {unknown} a @param {unknown} b @returns {boolean} */
export function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = object(a), y = object(b), keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => Object.hasOwn(y, k) && equal(x[k], y[k]));
}
/** @param {unknown} value @param {string} [prefix] @returns {RecordValue} */
export function flatten(value, prefix = '') {
  /** @type {RecordValue} */ const out = {};
  const v = object(value);
  if (Array.isArray(value) || value === null || typeof value !== 'object' || Object.keys(v).length === 0) {
    if (prefix && value !== undefined) out[prefix] = /** @type {Value} */ (value);
    return out;
  }
  for (const [key, item] of Object.entries(v)) Object.assign(out, flatten(item, prefix ? `${prefix}.${key}` : key));
  return out;
}
/** @param {number[]} values @param {number} [fraction] */
export function percentile(values, fraction = 0.5) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}
