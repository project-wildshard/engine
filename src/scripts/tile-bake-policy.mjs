// @ts-check
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { ratchetApprovalFailures } from './ratchet-approval.mjs';

export const TILE_BAKE_POLICY = 'lint/tile-bake-debt.json';
const address = '(?:0/[0-7]/[0-7]|1/[0-3]/[0-3])';
const key = v.pipe(v.string(), v.regex(new RegExp(`^(?:missing/${address}|(?:tile/${address}|window/[2-5]/[2-5])/(?:resident|compressed|triangles|draws))$`, 'u')));
const count = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const policy = v.strictObject({ version: v.literal(1), products: v.record(v.pipe(v.string(), v.regex(/^[a-z0-9_-]+$/u)), v.record(key, count)) });
/** Exact present debt; unlisted products, coordinates and metrics receive no allowance. @param {unknown} input */
export function parseTileBakePolicy(input) {
  const result = v.parse(policy, input);
  for (const rows of Object.values(result.products)) for (const [name, value] of Object.entries(rows))
    if (name.startsWith('missing/') && value !== 1) throw new Error('Missing tile debt must be one exact coordinate');
  return result;
}
/** The ordinary approval grammar also protects identities swapped at unchanged totals.
 * @param {unknown} before @param {unknown} after @param {string} message */
export function tileBakeApprovalFailures(before, after, message) {
  const next = parseTileBakePolicy(after);
  if (before === undefined) return ratchetApprovalFailures({}, { 'wildshard/tile-bake': { bootstrap: 1 } }, message, 'tiles');
  const previous = parseTileBakePolicy(before);
  /** @param {ReturnType<typeof parseTileBakePolicy>} rows */
  const flatten = rows => Object.fromEntries(Object.entries(rows.products).flatMap(([product, entries]) => Object.entries(entries).map(([name, value]) => [`${product}/${name}`, value])));
  return ratchetApprovalFailures({ 'wildshard/tile-bake': flatten(previous) }, { 'wildshard/tile-bake': flatten(next) }, message, 'tiles');
}
if (import.meta.main) {
  try {
    /** @param {string[]} args */
    const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const messageFile = process.argv.at(2);
    if (messageFile === undefined) throw new Error('Tile bake policy requires the commit message file');
    const message = readFileSync(messageFile, 'utf8');
    if (git(['diff', '--cached', '--name-only', '--', TILE_BAKE_POLICY]).trim() !== '' || message.replaceAll(/\n[ \t]+/gu, ' ').includes('Ratchet-Approved: wildshard-new wildshard/tile-bake ')) {
      const before = git(['ls-tree', 'HEAD', '--', TILE_BAKE_POLICY]).trim() === '' ? undefined : JSON.parse(git(['show', `HEAD:${TILE_BAKE_POLICY}`]));
      const after = JSON.parse(git(['show', `:${TILE_BAKE_POLICY}`]));
      const failures = tileBakeApprovalFailures(before, after, message);
      if (failures.length > 0) throw new Error(failures.join('\n'));
    }
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
