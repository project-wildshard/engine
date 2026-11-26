// BUDGET-CAPS BC2: the two files. budgets/caps.json holds each hard cap with the J-number that set it (Jake's word
// moves it); budgets/baselines.json holds each recorded baseline with the content key it was measured on (a command
// writes it). A cap key ending in /* covers every key under it; an exact key wins over a pattern.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { missesHardLimit } from './verdict.mjs';

export const CAPS_FILE = 'budgets/caps.json';
export const BASELINES_FILE = 'budgets/baselines.json';
const ROOT = resolve(import.meta.dirname, '../../..');

/** @param {string} [root] */
export const readCaps = (root = ROOT) => JSON.parse(readFileSync(resolve(root, CAPS_FILE), 'utf8'));
/** @param {string} [root] */
export const readBaselines = (root = ROOT) => JSON.parse(readFileSync(resolve(root, BASELINES_FILE), 'utf8'));
/** @param {unknown} baselines @param {string} [root] */
export function writeBaselines(baselines, root = ROOT) {
  writeFileSync(resolve(root, BASELINES_FILE), `${JSON.stringify(baselines, null, 1)}\n`);
}

/** The cap entry that governs a budget key: its own entry, else the longest `<prefix>/*` that covers it.
 * @param {{ caps: Record<string, any> }} caps @param {string} key */
export function capFor(caps, key) {
  if (Object.hasOwn(caps.caps, key)) return caps.caps[key];
  const covering = Object.keys(caps.caps).filter(pattern => pattern.endsWith('/*') && key.startsWith(pattern.slice(0, -1)));
  covering.sort((a, b) => b.length - a.length);
  return covering.length === 0 ? undefined : caps.caps[covering[0]];
}

/** Every rule BC2 holds the two files to, as messages; empty when they agree.
 * @param {{ caps: Record<string, any> }} caps @param {{ baselines: Record<string, any> }} baselines */
export function fileErrors(caps, baselines) {
  const errors = [];
  for (const [key, cap] of Object.entries(caps.caps)) {
    if (cap.hard !== null && (!Number.isFinite(cap.hard) || cap.hard <= 0)) errors.push(`${key}: hard must be a positive number or null`);
    if (cap.hard !== null && !/^J\d+$/u.test(cap.decision ?? '')) errors.push(`${key}: a hard cap names the J-number that set it`);
    if (cap.target !== undefined && !/^J\d+$/u.test(cap.decision ?? '')) errors.push(`${key}: a target names the J-number that set it`);
    if (cap.kind !== 'exact' && cap.kind !== 'noisy' && cap.kind !== 'floor') errors.push(`${key}: kind is exact, noisy, or floor`);
    if (cap.confirm !== undefined && (typeof cap.confirm !== 'boolean' || cap.kind !== 'noisy')) errors.push(`${key}: confirm is a boolean on a noisy cap`);
    if (typeof cap.unit !== 'string' || cap.unit === '') errors.push(`${key}: names a unit`);
    if (typeof cap.why !== 'string' || cap.why.trim() === '') errors.push(`${key}: says why`);
  }
  for (const [key, row] of Object.entries(baselines.baselines)) {
    const cap = capFor(caps, key);
    if (cap === undefined) { errors.push(`${key}: a baseline with no cap entry in ${CAPS_FILE}`); continue; }
    if (!Number.isFinite(row.value) || row.value < 0) errors.push(`${key}: value must be a measured number`);
    if (typeof row.contentKey !== 'string' || row.contentKey === '') errors.push(`${key}: names the content key it was measured on`);
    if (cap.hard !== null && missesHardLimit(cap.kind, row.value, cap.hard)) errors.push(`${key}: baseline ${row.value} ${cap.kind === 'floor' ? `is below its ${cap.hard} hard floor` : `is over its ${cap.hard} hard cap`}`);
    if (row.declared !== undefined && (typeof row.declared !== 'string' || row.declared.trim() === '')) errors.push(`${key}: a declared raise gives its reason`);
  }
  return errors;
}
