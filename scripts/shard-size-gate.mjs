#!/usr/bin/env node
// SHARD-SIZE row 1 (docs/plans/multi-repo/SHARD-SIZE-PLAN.md in project-wildshard-meta): every web build refuses a shard whose
// phone download grew. It reads the packs book, the list the page really downloads: `client.<slug>.phone.wireBytes`.
// budgets/shard-size-baseline.json holds the ceilings, the measured old numbers, how they were measured and how to
// change them on purpose. I12's older check read a tier selection, so Pine passed at 67 MB while phones took 111.
//
//   node scripts/shard-size-gate.mjs [dist]             refuse growth (scripts/build-app.mjs runs this, deploy.yml after `bake`)
//   node scripts/shard-size-gate.mjs [dist] --cooks-after   the build of a deploy whose cook adds shards: a row may still be missing
//   node scripts/shard-size-gate.mjs [dist] --ratchet   lower the ceilings of shards that shrank, in the baseline file
//   node scripts/shard-size-gate.mjs --folders <root>   print each shard folder's size by bucket, for a re-measure
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_FILE = 'budgets/shard-size-baseline.json';
const MB = bytes => `${(bytes / 1e6).toFixed(2)} MB`;

/** Each product's phone download from a built `dist`, or null for a build with no packs book (a native or SDK output). A
 * cooked row (`<slug>-whole-phone-`, written by `cook-worker bake`) names only the shard's half, and that page reads the
 * engine half too, so the gate reads both: what a phone gets, not what the row lists.
 * @param {string} dist
 * @returns {Record<string, number> | null} */
export function readPhoneDownloads(dist) {
  // This build's own book by its id: a deploy carries older builds' files into dist beside it.
  const version = resolve(dist, 'version.json');
  if (!existsSync(version)) return null;
  const { build } = JSON.parse(readFileSync(version, 'utf8')), book = resolve(dist, `assets/spawn/packs-${build}.json`);
  if (!existsSync(book)) return null;
  const { client } = JSON.parse(readFileSync(book, 'utf8'));
  const cooked = row => /-whole-phone-[a-f0-9]+\.json$/u.test(row.phone.url ?? '');
  const engine = Object.values(client).some(cooked) ? JSON.parse(readFileSync(resolve(dist, `assets/spawn/engine-${build}.json`), 'utf8')).client.phone.wireBytes : 0;
  return Object.fromEntries(Object.entries(client).map(([slug, row]) => [slug, row.phone.wireBytes + (cooked(row) ? engine : 0)]));
}

/** What a shard may legally have as a ceiling: its baseline, or the last approved raise. A shrink-only shard may also sit
 * at the level it held when the baseline was recorded (`recordedPhoneBytes`), never higher. Once a ratchet latched it
 * (`latchedPhoneBytes`), that is the level: a shard that reached it never gets the old room back without a raise.
 * @param {string} slug
 * @param {{ baselinePhoneBytes: number, recordedPhoneBytes: number, latchedPhoneBytes?: number, shrinkOnly: boolean }} row
 * @param {readonly { shard: string, toBytes: number }[]} raises */
function legalCeiling(slug, row, raises) {
  const approved = raises.filter(raise => raise.shard === slug).map(raise => raise.toBytes);
  return Math.max(row.latchedPhoneBytes ?? Math.max(row.baselinePhoneBytes, row.shrinkOnly ? row.recordedPhoneBytes : 0), ...approved);
}

/** Refuse growth. Pure: the baseline file's parsed contents and the measured downloads in, messages out. A baseline shard
 * with no row is refused too (a shard that left the build must arrive through the cook, or nothing measures it), unless
 * `cooksAfter` says a later step adds rows and the gate runs again on its output.
 * @param {{ limits: { newShardHardCapBytes: number, toleranceBytes: number, ratchetSlackBytes: number },
 *   shards: Record<string, { baselinePhoneBytes: number, recordedPhoneBytes: number, ceilingPhoneBytes: number, shrinkOnly: boolean }>,
 *   raises: readonly { shard: string, toBytes: number, decision: string, why: string }[] }} baseline
 * @param {Record<string, number>} downloads
 * @param {{ cooksAfter?: boolean }} [options]
 * @returns {{ errors: string[], notes: string[] }} */
export function checkShardSizes(baseline, downloads, { cooksAfter = false } = {}) {
  const errors = [], notes = [], { limits, shards, raises } = baseline;
  for (const raise of raises) {
    if (!/^[GE]\d+$/u.test(raise.decision) || raise.why.trim() === '') errors.push(`shard size: the raise of ${raise.shard} names no decision (G### or E###) and why`);
  }
  for (const [slug, row] of Object.entries(shards)) {
    const legal = legalCeiling(slug, row, raises);
    if (row.ceilingPhoneBytes > legal) errors.push(`shard size: ${slug}'s ceiling ${MB(row.ceilingPhoneBytes)} is past the ${MB(legal)} it may hold; a raise needs a row in "raises" with Jake's decision (${BASELINE_FILE})`);
    if (!row.shrinkOnly && row.ceilingPhoneBytes > row.baselinePhoneBytes) errors.push(`shard size: ${slug} has a ceiling past its baseline, so it must be shrinkOnly; run --ratchet`);
    const bytes = downloads[slug];
    if (bytes === undefined) {
      if (!cooksAfter) errors.push(`shard size: ${slug} has a baseline and no row in the book, so nothing measures it. A shard leaves the build only through the cook, with this gate run on the cooked output.`);
      continue;
    }
    if (bytes > row.ceilingPhoneBytes + limits.toleranceBytes) errors.push(`shard size: ${slug} downloads ${MB(bytes)} on a phone, past its ${MB(row.ceilingPhoneBytes)} ceiling (baseline ${MB(row.baselinePhoneBytes)}${row.shrinkOnly ? ', shrink-only' : ''}). Shrink it, or get Jake's decision and add a row to "raises" in ${BASELINE_FILE}.`);
    else if (bytes < row.ceilingPhoneBytes - limits.ratchetSlackBytes && row.shrinkOnly) errors.push(`shard size: ${slug} shrank to ${MB(bytes)}; latch it in this change: node scripts/shard-size-gate.mjs dist --ratchet`);
    if (row.shrinkOnly) notes.push(`shard size: ${slug} ${MB(bytes)} shrink-only, ${MB(bytes - row.baselinePhoneBytes)} over its baseline`);
  }
  for (const [slug, bytes] of Object.entries(downloads)) {
    if (!Object.hasOwn(shards, slug) && bytes > limits.newShardHardCapBytes) errors.push(`shard size: new shard ${slug} downloads ${MB(bytes)} on a phone, past the ${MB(limits.newShardHardCapBytes)} hard cap for a shard with no baseline`);
  }
  return { errors, notes };
}

/** The baseline with each shrink-only ceiling lowered to what the shard downloads now, past its baseline if it got there:
 * a shard that reached 58 can't regrow to a 78 baseline unrefused. A shard held at its baseline stays there, and so does one
 * inside the slack: build noise is no shrink, and latching it would leave no room for the next build's.
 * @template {{ limits: { ratchetSlackBytes: number }, shards: Record<string, { ceilingPhoneBytes: number, latchedPhoneBytes?: number, shrinkOnly: boolean }> }} T
 * @param {T} baseline @param {Record<string, number>} downloads @returns {T} */
export function ratchetShardSizes(baseline, downloads) {
  const shards = Object.fromEntries(Object.entries(baseline.shards).map(([slug, row]) => {
    const bytes = downloads[slug];
    if (bytes === undefined || bytes >= row.ceilingPhoneBytes - baseline.limits.ratchetSlackBytes || !row.shrinkOnly) return [slug, row];
    return [slug, { ...row, ceilingPhoneBytes: bytes, latchedPhoneBytes: bytes }];
  }));
  return { ...baseline, shards };
}

/** One shard folder's bytes by bucket: `blobs/<kind>`, `mounts/<name>`, then each other top-level name.
 * @param {string} folder @returns {{ totalBytes: number, files: number, buckets: Record<string, number> }} */
export function folderBuckets(folder) {
  /** @type {Record<string, number>} */
  const buckets = {};
  let totalBytes = 0, files = 0;
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const parts = join(entry.parentPath, entry.name).slice(folder.length + 1).split('/');
    const bucket = parts.length === 1 ? 'root' : parts[0] === 'blobs' || parts[0] === 'mounts' ? `${parts[0]}/${parts[1]}` : parts[0];
    const bytes = lstatSync(join(entry.parentPath, entry.name)).size;
    buckets[bucket] = (buckets[bucket] ?? 0) + bytes; totalBytes += bytes; files++;
  }
  return { totalBytes, files, buckets };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), root = resolve(import.meta.dirname, '..'), file = resolve(root, BASELINE_FILE);
  if (args[0] === '--folders') {
    const out = resolve(args[1] ?? root, 'out'), baseline = JSON.parse(readFileSync(file, 'utf8'));
    console.info(JSON.stringify(Object.fromEntries(Object.keys(baseline.shards).map(slug => [slug, folderBuckets(join(out, slug))])), null, 1));
  } else {
    const ratchet = args.includes('--ratchet'), cooksAfter = args.includes('--cooks-after'), dist = resolve(args.find(arg => !arg.startsWith('--')) ?? 'dist');
    const downloads = readPhoneDownloads(dist);
    if (downloads === null) console.info(`shard size: ${dist} has no packs book; nothing to check`);
    else {
      const baseline = JSON.parse(readFileSync(file, 'utf8'));
      if (ratchet) writeFileSync(file, `${JSON.stringify(ratchetShardSizes(baseline, downloads), null, 1)}\n`);
      const { errors, notes } = checkShardSizes(ratchet ? JSON.parse(readFileSync(file, 'utf8')) : baseline, downloads, { cooksAfter });
      for (const note of notes) console.info(note);
      for (const error of errors) console.error(error);
      if (errors.length > 0) process.exitCode = 1;
      else console.info(`shard size: ${Object.keys(downloads).length} products within their phone ceilings`);
    }
  }
}
