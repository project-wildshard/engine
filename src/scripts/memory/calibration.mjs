// The calibration table (ENGINE-MEMORY EM1): for each host and allocation kind, MB of kernel footprint [K] per MB the
// page holds, per browser process, fitted over 0/128/256/512 MB in fresh browsers. src/scripts/memory/calibrate.mjs takes
// the readings; this module fits them and checks the table. EM8 and EM11 read the weights from calibration.json.
import * as v from 'valibot';

export const MB = 1e6;
export const HOSTS = /** @type {const} */ (['webkit', 'chromium', 'simulator']);
export const KINDS = /** @type {const} */ (['none', 'arraybuffer', 'jsheap', 'wasm', 'worker', 'texrgba', 'texcomp', 'glbuffer', 'msaa', 'canvas2d', 'imagebitmap', 'audio']);

const finite = v.pipe(v.number(), v.finite());
const fitSchema = v.object({ slope: finite, interceptMB: finite, r2: finite });
const kindSchema = v.object({
  unit: v.string(),
  lands: v.string(),
  slope: finite,
  interceptMB: finite,
  r2: finite,
  spread: v.object({ runs: v.pipe(v.number(), v.integer(), v.minValue(1)), slopeMin: finite, slopeMax: finite, at256MB: v.nullable(finite) }),
  sizesMB: v.array(finite),
  roles: v.record(v.string(), fitSchema),
  format: v.optional(v.string()),
  note: v.optional(v.string()),
});
const hostSchema = v.object({
  instrument: v.string(),
  browser: v.string(),
  measured: v.string(),
  engine: v.string(),
  baselineMB: v.record(v.string(), finite),
  kinds: v.record(v.string(), kindSchema),
});
export const calibrationSchema = v.object({ version: v.literal(1), note: v.string(), hosts: v.record(v.picklist(HOSTS), hostSchema) });

/** @param {number} x @param {number} digits */
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Least-squares line through (x, y) points.
 * @param {readonly (readonly [number, number])[]} points @returns {{slope:number, interceptMB:number, r2:number}} */
export function fitLine(points) {
  if (points.length < 2) throw new Error('a fit needs two points or more');
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n, my = points.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  if (sxx === 0) throw new Error('a fit needs two different sizes');
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope: round(slope, 4), interceptMB: round(my - slope * mx, 1), r2: round(r2, 4) };
}

/** @typedef {{host:string, kind:string, run:number, askedMB:number, gotBytes:number, unit:string, format?:string, error?:string|null, roles:Record<string, number>}} Reading */

/** Fit one host's readings into its table entry. `roles` holds footprint bytes per process role. The kind lands in the
 * role with the largest slope; its spread is the slope fitted to each run alone, and the run-to-run range of the
 * landing role's footprint at 256 MB.
 * @param {readonly Reading[]} readings
 * @returns {{baselineMB: Record<string, number>, kinds: Record<string, v.InferOutput<typeof kindSchema>>}} */
export function fitHost(readings) {
  const ok = readings.filter((r) => !r.error);
  /** @type {Record<string, number[]>} */
  const base = {};
  for (const r of ok.filter((x) => x.kind === 'none')) for (const [role, bytes] of Object.entries(r.roles)) (base[role] ??= []).push(bytes / MB);
  const baselineMB = Object.fromEntries(Object.entries(base).map(([role, values]) => [role, round(median(values), 1)]));
  /** @type {Record<string, v.InferOutput<typeof kindSchema>>} */
  const kinds = {};
  for (const kind of [...new Set(ok.map((r) => r.kind))].filter((k) => k !== 'none')) {
    const rows = ok.filter((r) => r.kind === kind);
    if (new Set(rows.map((r) => r.gotBytes)).size < 2) continue;
    const roleNames = [...new Set(rows.flatMap((r) => Object.keys(r.roles)))].sort();
    /** @type {Record<string, {slope:number, interceptMB:number, r2:number}>} */
    const roles = {};
    for (const role of roleNames) {
      const points = rows.filter((r) => role in r.roles).map((r) => /** @type {[number, number]} */ ([r.gotBytes / MB, r.roles[role] / MB]));
      if (new Set(points.map(([x]) => x)).size >= 2) roles[role] = fitLine(points);
    }
    const lands = Object.entries(roles).sort((a, b) => b[1].slope - a[1].slope)[0]?.[0];
    if (lands === undefined) continue;
    const runSlopes = [...new Set(rows.map((r) => r.run))].map((run) => rows.filter((r) => r.run === run && lands in r.roles))
      .filter((rs) => new Set(rs.map((r) => r.gotBytes)).size >= 2)
      .map((rs) => fitLine(rs.map((r) => [r.gotBytes / MB, r.roles[lands] / MB])).slope);
    const at256 = rows.filter((r) => r.askedMB === 256 && lands in r.roles).map((r) => r.roles[lands] / MB);
    const format = rows.find((r) => r.format)?.format;
    kinds[kind] = {
      unit: rows[0].unit, lands, ...roles[lands],
      spread: { runs: runSlopes.length, slopeMin: Math.min(...runSlopes), slopeMax: Math.max(...runSlopes),
        at256MB: at256.length >= 2 ? round(Math.max(...at256) - Math.min(...at256), 1) : null },
      sizesMB: [...new Set(rows.map((r) => r.askedMB))].sort((a, b) => a - b),
      roles,
      ...(format ? { format } : {}),
    };
  }
  return { baselineMB, kinds };
}

/** @param {readonly number[]} values */
export function median(values) {
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length === 0 ? Number.NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Validate a calibration table. @param {unknown} table */
export function parseCalibration(table) {
  return v.parse(calibrationSchema, table);
}

/** The 2026-11-17 instrument probe (meta docs/plans/engine-memory/INSTRUMENTS-2026-11-17.md): one 256 MB point over the
 * `none` page, so each ratio is (footprint at 256 - none) / bytes held, in the process the probe named. */
export const PROBE_2026_11_17 = {
  webkit: { arraybuffer: ['webcontent', 256.6 / 256], worker: ['webcontent', 259.9 / 256], wasm: ['webcontent', 256.7 / 256],
    jsheap: ['webcontent', 483.9 / 256], texrgba: ['gpu', 354.4 / 251.7], texcomp: ['gpu', 361.7 / 260], glbuffer: ['gpu', 260.7 / 256],
    msaa: ['gpu', 289.2 / 268.4], canvas2d: ['gpu', 267.8 / 268.4] },
  chromium: { arraybuffer: ['renderer', 258.3 / 256], worker: ['renderer', 261.9 / 256], wasm: ['renderer', 274.8 / 256.05],
    jsheap: ['renderer', 322 / 256], imagebitmap: ['renderer', 282 / 268.4], audio: ['renderer', 267.5 / 261.1],
    texrgba: ['gpu', 334.9 / 251.7], texcomp: ['gpu', 354.1 / 260.05], glbuffer: ['gpu', 274 / 256], msaa: ['gpu', 282 / 268.4], canvas2d: ['gpu', 279 / 268.4] },
  simulator: { arraybuffer: ['webcontent', 256.7 / 256], texrgba: ['simmetalhost', 356.2 / 251.7], texcomp: ['simmetalhost', 1145.5 / 260],
    glbuffer: ['gpu', 257.1 / 256], msaa: ['simmetalhost', 295.8 / 268.4], canvas2d: ['simmetalhost', 370 / 268.4] },
};

/** Compare a host's table with the probe: the probe's single-point ratio against this table's footprint added at 256 MB
 * over `none` ((slope x 256 + intercept - baseline) / 256) in the same role. Within `tolerance` is a match.
 * @param {string} host @param {{baselineMB: Record<string, number>, kinds: Record<string, {roles: Record<string, {slope:number, interceptMB:number}>}>}} table
 * @param {number} [tolerance] */
export function compareWithProbe(host, table, tolerance = 0.1) {
  const probe = /** @type {Record<string, [string, number]>} */ (Reflect.get(PROBE_2026_11_17, host) ?? {});
  return Object.entries(probe).map(([kind, [role, ratio]]) => {
    const fit = table.kinds[kind]?.roles[role];
    if (!fit) return { kind, role, probe: round(ratio, 3), table: null, slope: null, within: false };
    const at256 = (fit.slope * 256 + fit.interceptMB - (table.baselineMB[role] ?? 0)) / 256;
    return { kind, role, probe: round(ratio, 3), table: round(at256, 3), slope: fit.slope, within: Math.abs(at256 - ratio) <= tolerance * ratio };
  });
}
