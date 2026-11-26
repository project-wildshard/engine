// Repo-only build policy: the SDK receives a number and never reads lint inventories.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';

const pathSchema = v.pipe(v.string(), v.check(path => path.length > 0 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')));
const basisSchema = v.strictObject({ schema: v.literal('legacy-line-basis/1'), revision: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)),
  shards: v.record(pathSchema, v.strictObject({ source: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)),
    excluded: v.array(pathSchema), files: v.record(pathSchema, v.pipe(v.number(), v.integer(), v.minValue(0))) })) });
// The historical producer exclusions and per-file counts are pinned at 1258254a3.
// Never recount with today's producer catalogue or compatibility-only frozen edits:
// e45fe0e4d and a888b0ac1 moved the denominator without removing custom work.
// See progress/shard-platform/ruler-basis-2026-10-17/README.md for the audit.
function lineBasis(root) {
  return v.parse(basisSchema, JSON.parse(readFileSync(resolve(root, 'lint/legacy-line-basis.json'), 'utf8')));
}
/** Shard-owned historical counts survive retirement of the frozen folder list.
 * The checked-in basis declares both the unchanged AS denominator and provenance. */
export function shardLineBaselines(root) {
  if (!existsSync(resolve(root, 'lint/legacy-line-basis.json'))) return new Map();
  return new Map(Object.entries(lineBasis(root).shards).map(([slug, pinned]) => {
    const lines = Object.values(pinned.files).reduce((total, amount) => total + amount, 0);
    if (lines <= 0) throw new Error(`${slug}: pinned basis has no authored TypeScript lines`);
    return [slug, { source: pinned.source, lines }];
  }));
}
/** Same pinned denominator for the official build adapter and P4 ruler; no inventory lookup. */
export function decisionLegacyLines(root, slug) {
  return shardLineBaselines(root).get(slug)?.lines;
}
