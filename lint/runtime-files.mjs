// SHARD-PLATFORM W2 (coordinator call, flagged for Jake): a custom runtime/ holds at most 128 source files, except a
// first-party shard listed in lint/runtime-files.json, whose checked-in ceiling may be higher while W2 moves its client
// play folders into runtime/ wholesale (G450 (5)). That ceiling is shrink-only: it falls as W3 converts sim and data out,
// and it rises only with a new `raises` line naming the slug, the old and new ceiling and why. Third-party projects, the
// Template and any slug without a line keep the 128 default. The author CLI reads the ceiling only for trusted checkout
// provenance (src/sharddev/performancePolicy.ts 'warn'); every other project refuses above 128.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RUNTIME_FILE_DEFAULT = 128;
export const RUNTIME_FILES_LIST = 'lint/runtime-files.json';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

/** Shape failures of a runtime-files policy, as messages. @param {unknown} policy */
export function runtimeFilesShape(policy) {
  if (!object(policy)) return ['runtime-files policy must be an object'];
  const failures = [];
  if (Object.keys(policy).sort().join(',') !== 'about,ceilings,default,raises') failures.push('runtime-files policy needs exactly about, ceilings, default, raises');
  if (policy.default !== RUNTIME_FILE_DEFAULT) failures.push(`runtime-files default must stay ${RUNTIME_FILE_DEFAULT}`);
  if (typeof policy.about !== 'string' || policy.about.trim() === '') failures.push('runtime-files policy needs an about line');
  if (!object(policy.ceilings) || Object.values(policy.ceilings).some(value => !count(value))) failures.push('runtime-files ceilings must be whole file counts');
  if (!Array.isArray(policy.raises) || policy.raises.some(raise => !object(raise) || Object.keys(raise).sort().join(',') !== 'from,slug,to,why'
    || typeof raise.slug !== 'string' || !count(raise.from) || !count(raise.to) || raise.to <= raise.from || typeof raise.why !== 'string' || raise.why.trim() === '')) {
    failures.push('runtime-files raises must be {slug, from, to, why} lines with to above from');
  }
  return failures;
}

/** The runtime/ source-file ceiling of a slug; the default for any slug without a line. @param {unknown} policy @param {string} slug */
export function runtimeFileCeiling(policy, slug) {
  const failures = runtimeFilesShape(policy);
  if (failures.length > 0) throw new Error(failures.join('; '));
  const ceilings = /** @type {{ ceilings: Record<string, number> }} */ (policy).ceilings;
  return Object.hasOwn(ceilings, slug) ? ceilings[slug] : RUNTIME_FILE_DEFAULT;
}

/** Read the checked-in policy of a checkout. @param {string} root */
export function readRuntimeFiles(root) {
  return /** @type {unknown} */ (JSON.parse(readFileSync(resolve(root, RUNTIME_FILES_LIST), 'utf8')));
}

/** Shrink-only: compare a candidate policy with its predecessor (undefined when the list is new). A ceiling may fall or
 * drop freely; a rise (a slug above its old ceiling, or a new slug above the default) needs a new `raises` line whose
 * from/to match it exactly. Raise lines are history: none may be removed or edited.
 * @param {unknown} before @param {unknown} after @returns {string[]} */
export function compareRuntimeFiles(before, after) {
  const failures = runtimeFilesShape(after);
  if (failures.length > 0) return failures;
  const next = /** @type {{ ceilings: Record<string, number>, raises: {slug: string, from: number, to: number, why: string}[] }} */ (after);
  const previous = before === undefined ? { ceilings: {}, raises: [] } : /** @type {typeof next} */ (before);
  if (before !== undefined && runtimeFilesShape(before).length > 0) return ['runtime-files predecessor is malformed'];
  const line = (/** @type {{slug: string, from: number, to: number, why: string}} */ raise) => JSON.stringify([raise.slug, raise.from, raise.to, raise.why]);
  const kept = new Set(next.raises.map(line));
  for (const raise of previous.raises) if (!kept.has(line(raise))) failures.push(`runtime-files raise line removed or edited: ${raise.slug} ${raise.from} -> ${raise.to}`);
  const old = new Set(previous.raises.map(line));
  const fresh = next.raises.filter(raise => !old.has(line(raise)));
  const used = new Set();
  for (const [slug, ceiling] of Object.entries(next.ceilings)) {
    const was = Object.hasOwn(previous.ceilings, slug) ? previous.ceilings[slug] : RUNTIME_FILE_DEFAULT;
    if (ceiling <= was) continue;
    const raise = fresh.find(item => item.slug === slug && item.from === was && item.to === ceiling);
    if (raise === undefined) failures.push(`runtime-files: ${slug} ceiling rises ${was} -> ${ceiling} without a raises line {slug, from: ${was}, to: ${ceiling}, why}`);
    else used.add(raise);
  }
  for (const raise of fresh) if (!used.has(raise)) failures.push(`runtime-files: raise line ${raise.slug} ${raise.from} -> ${raise.to} matches no ceiling change`);
  return failures;
}
