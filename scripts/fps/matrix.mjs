// Persist exact-build cells separately so a later run can resume the matrix.
import { createHash } from 'node:crypto';
import { existsSync, linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fpsVerdict } from './verdict.mjs';

/** @typedef {{name:string, seconds:number}} Leg */
/** @typedef {Parameters<typeof fpsVerdict>[0][number]} Frames */
/** @typedef {{version?:{build:string}, witness?:{build:string, gpu:string|null}, legs?:Frames[],
 * costs?:unknown[], verdict:string, error?:string, boot?:{routeStarted?:boolean}}} Capture */
/** @typedef {{browser:string,cold:Capture,warm:Capture|null}} CellReport */
/** @typedef {{id:string,interval:Leg,route?:Leg[],floor:number,warm:boolean}} Cell */

const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** @param {unknown} value */
export function signature(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** @param {string} file @param {unknown} value */
export function atomicJson(file, value) {
  const scratch = `${file}.${process.pid}.tmp`;
  writeFileSync(scratch, `${JSON.stringify(value)}\n`);
  renameSync(scratch, file);
}

/** @param {string} out @param {string} fingerprint @param {unknown} config */
export function openResume(out, fingerprint, config) {
  const path = join(out, 'resume.json');
  const scratch = `${path}.${process.pid}.tmp`;
  writeFileSync(scratch, JSON.stringify({ schema:1, fingerprint, config }));
  try { linkSync(scratch, path); }
  catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST') throw error;
  } finally { unlinkSync(scratch); }
  const state = read(path);
  if (state.schema !== 1 || state.fingerprint !== fingerprint)
    throw new Error('Resume belongs to a different build, route or profile plan. Choose another --out directory.');
}

/** @param {string} out @param {string} id */
export function cellPath(out, id) { return join(out, `cell-${id}.json`); }

/** @param {Capture|null|undefined} capture @param {string} build @param {Cell} cell */
function complete(capture, build, cell) {
  return (capture?.verdict === 'pass' || capture?.verdict === 'miss') &&
    capture.version?.build === build && capture.witness?.build === build &&
    fpsVerdict(capture.legs ?? [], cell.route ?? [cell.interval], cell.floor).verdict !== 'incomplete';
}

/** @param {string} file @param {string} fingerprint @param {string} build @param {Cell} cell */
export function readCell(file, fingerprint, build, cell) {
  if (!existsSync(file)) return null;
  /** @type {{fingerprint:string,id:string,report:CellReport}} */
  const saved = read(file);
  if (saved.fingerprint !== fingerprint || saved.id !== cell.id) throw new Error(`Mismatched resume cell ${cell.id}`);
  const { report } = saved;
  if (!complete(report.cold, build, cell) || (cell.warm && !complete(report.warm, build, cell))) return null;
  return report;
}

/** Assemble the old report shape for the nightly grader, scoring every leg in route order.
 * @param {(Capture|null|undefined)[]} cells @param {Leg[]} route @param {number} floor
 */
export function assembleCapture(cells, route, floor) {
  const legs = route.map((expected, idx) => cells[idx]?.legs?.[0] ?? { name:expected.name, error:'cell pending' });
  const score = fpsVerdict(legs, route, floor);
  const first = cells.find(cell => cell !== null && cell !== undefined);
  const mixed = cells.some(cell => cell !== null && cell !== undefined &&
    (cell.version?.build !== first?.version?.build || cell.witness?.gpu !== first?.witness?.gpu));
  return { ...score, legs, costs:cells.flatMap(cell => cell?.costs ?? []),
    version:first?.version, witness:first?.witness,
    ...(mixed ? { verdict:'incomplete', error:'build or GPU differs across cells' } : {}) };
}
