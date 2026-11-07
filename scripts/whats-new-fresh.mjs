#!/usr/bin/env node
// whats-new-fresh.mjs — the main menu's WHAT'S NEW lines may be at most 24 h stale (E482, Jake 2026-10-17).
//
//   node scripts/whats-new-fresh.mjs <sha>     reads src/client/game/whatsNew.json from that commit (git show <sha>:…)
//
// The pre-push hook runs it on every push to refs/heads/main. It fails when the file's `updated` (an ISO 8601 timestamp
// with an offset) is missing, unparseable, more than 1 h in the future, or older than 24 h. The fix is always the same:
// rewrite the 3–5 entries with what changed in the playable build since the last update, set `date` and `updated` to now,
// and commit src/client/game/whatsNew.json.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const WHATS_NEW_PATH = 'src/client/game/whatsNew.json';
const HOUR = 3_600_000;
export const MAX_AGE_MS = 24 * HOUR;
export const MAX_FUTURE_MS = HOUR;
/** an ISO 8601 date-time with seconds optional and a required zone (Z or ±hh:mm) */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

const HOW = `Fix: rewrite ${WHATS_NEW_PATH} — 3–5 short lines of what changed in the playable build since the last update,`
  + ` "date" as the banner shows it ("17 OCT 2026") and "updated" set to now (e.g. "${new Date().toISOString().slice(0, 16)}Z"),`
  + ' then commit it and push again.';

/**
 * The verdict for one whatsNew.json body at `now` (ms): null when fresh, else the reason and how to fix it.
 * @param {string} body
 * @param {number} now
 * @returns {string | null}
 */
export function staleReason(body, now) {
  let json;
  try { json = JSON.parse(body); } catch { return `whats-new: ${WHATS_NEW_PATH} is not valid JSON. ${HOW}`; }
  const updated = json !== null && typeof json === 'object' ? json.updated : undefined;
  if (typeof updated !== 'string') return `whats-new: ${WHATS_NEW_PATH} has no "updated" timestamp. ${HOW}`;
  const at = ISO.test(updated) ? Date.parse(updated) : Number.NaN;
  if (!Number.isFinite(at)) return `whats-new: "updated" is ${JSON.stringify(updated)}, not an ISO timestamp with a zone. ${HOW}`;
  if (at - now > MAX_FUTURE_MS) return `whats-new: "updated" ${updated} is more than 1 h in the future. ${HOW}`;
  const age = now - at;
  if (age > MAX_AGE_MS) return `whats-new: the WHAT'S NEW lines are ${(age / HOUR).toFixed(1)} h old (updated ${updated}); the limit is 24 h. ${HOW}`;
  return null;
}

/** @param {string[]} argv */
function main(argv) {
  const sha = argv[0];
  if (!sha) { console.error('usage: whats-new-fresh.mjs <sha>'); return 2; }
  let body;
  try {
    body = execFileSync('git', ['show', `${sha}:${WHATS_NEW_PATH}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    console.error(`whats-new: ${WHATS_NEW_PATH} is missing at ${sha}. ${HOW}`);
    return 1;
  }
  const reason = staleReason(body, Date.now());
  if (reason) { console.error(reason); return 1; }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) process.exitCode = main(process.argv.slice(2));
