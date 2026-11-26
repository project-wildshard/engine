#!/usr/bin/env node
// SHARD-SIZE row 1, judged by BUDGET-CAPS BC4 (meta docs/plans/BUDGET-CAPS-PLAN.md; J444, J437): every web build reads
// each shard's phone download from the packs book (`client.<slug>.phone.wireBytes`, what the page really downloads) and
// judges it with src/scripts/budgets/verdict.mjs. The hard cap is budgets/caps.json `download/phone/*` (J338, 100 MB). The
// baseline is budgets/baselines.json `download/phone/<slug>`, tied to the shard's pinned revision: a new revision is new
// content and only the hard cap applies until it is recorded; the same revision 10% over its baseline is a regression.
// Nothing fails for getting smaller. budgets/shard-size-baseline.json keeps the measured history and how it was measured.
//
//   node src/scripts/shard-size-gate.mjs [dist]                 judge (src/scripts/build-app.mjs runs this)
//   node src/scripts/shard-size-gate.mjs [dist] --cooks-after   the build of a deploy whose cook adds shards: a row may still be missing
//   node src/scripts/shard-size-gate.mjs [dist] --hard-only     fail only past a hard cap (release qualification)
//   node src/scripts/shard-size-gate.mjs [dist] --measures <f>  also write the measures for src/scripts/budgets/cli.mjs
//   node src/scripts/shard-size-gate.mjs [dist] --record        record these downloads as the baselines
//   node src/scripts/shard-size-gate.mjs --folders <root>       print each shard folder's size by bucket, for a re-measure
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentDirOf } from './app-build/splitOutput.mjs';
import { budgetTable, failed, judgeAll, recordAll } from './budgets/cli.mjs';
import { readBaselines, readCaps, writeBaselines } from './budgets/files.mjs';

export const BASELINE_FILE = 'budgets/shard-size-baseline.json';
export const PINS_FILE = 'test/pins/shardfiles.json';
const KEY = 'download/phone/';
const MB = bytes => `${(bytes / 1e6).toFixed(2)} MB`;

/** Each product's phone download from a built `dist` (its book in `dist-content/` when split), or null for a build with
 * no packs book (a native or SDK output). A
 * cooked row (`<slug>-whole-phone-`, written by `cook-worker bake`) names only the shard's half, and that page reads the
 * engine half too, so the gate reads both: what a phone gets, not what the row lists.
 * @param {string} dist
 * @returns {Record<string, number> | null} */
export function readPhoneDownloads(dist) {
  // This build's own book by its id: a deploy carries older builds' files into dist beside it.
  const version = resolve(dist, 'version.json');
  if (!existsSync(version)) return null;
  // PAGE-SIZE PZ4: build:game splits the page, so the books sit in dist-content/. A book in dist itself comes first: that
  // is build-app.mjs's own run, before the split, and a dist-content beside it is an older build's (the same id when a
  // release rebuilds one SHA).
  const { build } = JSON.parse(readFileSync(version, 'utf8'));
  const books = [resolve(dist), contentDirOf(dist)].find(dir => existsSync(resolve(dir, `assets/spawn/packs-${build}.json`)));
  if (books === undefined) return null;
  const { client } = JSON.parse(readFileSync(resolve(books, `assets/spawn/packs-${build}.json`), 'utf8'));
  const cooked = row => /-whole-phone-[a-f0-9]+\.json$/u.test(row.phone.url ?? '');
  const engine = Object.values(client).some(cooked) ? JSON.parse(readFileSync(resolve(books, `assets/spawn/engine-${build}.json`), 'utf8')).client.phone.wireBytes : 0;
  return Object.fromEntries(Object.entries(client).map(([slug, row]) => [slug, row.phone.wireBytes + (cooked(row) ? engine : 0)]));
}

/** Each pinned shard's content key, `<slug>@<revision>`, from the pins this tree builds.
 * @param {string} [root] @returns {Record<string, string>} */
export function pinnedContentKeys(root = resolve(import.meta.dirname, '..', '..')) {
  const { shards } = JSON.parse(readFileSync(resolve(root, PINS_FILE), 'utf8'));
  return Object.fromEntries(shards.map((/** @type {{ slug: string, revision: number }} */ pin) => [pin.slug, `${pin.slug}@${pin.revision}`]));
}

/** The downloads as budget measures; a product with no pin is the engine's own content.
 * @param {Record<string, number>} downloads @param {Record<string, string>} contentKeys */
export function shardMeasures(downloads, contentKeys) {
  return { measures: Object.fromEntries(Object.entries(downloads).map(([slug, value]) => [`${KEY}${slug}`, { value, contentKey: contentKeys[slug] ?? 'engine' }])) };
}

/** Judge the downloads. Pure: the two budget files and the measured downloads in, messages and table rows out. A
 * baseline shard with no row is refused too (a shard that left the build must arrive through the cook, or nothing
 * measures it), unless `cooksAfter` says a later step adds rows and the gate runs again on its output.
 * @param {{ caps: import('./budgets/files.mjs').BudgetCaps, baselines: import('./budgets/files.mjs').BudgetBaselines }} budgets
 * @param {Record<string, number>} downloads
 * @param {{ contentKeys: Record<string, string>, cooksAfter?: boolean, hardOnly?: boolean }} options */
export function checkShardSizes({ caps, baselines }, downloads, { contentKeys, cooksAfter = false, hardOnly = false }) {
  const errors = [], notes = [];
  for (const key of Object.keys(baselines.baselines)) {
    if (!key.startsWith(KEY) || downloads[key.slice(KEY.length)] !== undefined || cooksAfter) continue;
    errors.push(`shard size: ${key.slice(KEY.length)} has a baseline and no row in the book, so nothing measures it. A shard leaves the build only through the cook, with this gate run on the cooked output.`);
  }
  const rows = judgeAll(caps, baselines, shardMeasures(downloads, contentKeys));
  for (const row of rows) {
    const slug = row.key.slice(KEY.length);
    if (row.status === 'unknown') errors.push(`shard size: ${row.key} has no cap entry in budgets/caps.json`);
    else if (row.status === 'over-hard') errors.push(`shard size: ${slug} downloads ${MB(row.value ?? 0)} on a phone, past the ${MB(row.hard ?? 0)} hard cap (budgets/caps.json; a hard cap moves only on Jake's word)`);
    else if (row.status === 'regressed' && !hardOnly) errors.push(`shard size: ${slug} regressed: ${MB(row.value ?? 0)} on the same content (${row.contentKey}) as its ${MB(row.baseline ?? 0)} baseline, at or past the ${MB(row.line ?? 0)} soft line. Growth with no new content is a fix row; an engine feature declares it: node src/scripts/budgets/cli.mjs declare ${row.key} --why "<feature>"`);
    else if (row.status === 'raised') notes.push(`shard size: ${slug} ${MB(row.value ?? 0)} is new content (${row.previousKey ?? 'no baseline'} -> ${row.contentKey}); record it: node src/scripts/shard-size-gate.mjs dist --record`);
  }
  if (failed(rows, { hardOnly }) && errors.length === 0) errors.push('shard size: the budget verdict failed');
  return { errors, notes, rows };
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
  const args = process.argv.slice(2), root = resolve(import.meta.dirname, '..', '..');
  const flag = name => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
  if (args[0] === '--folders') {
    const out = resolve(args[1] ?? root, 'out'), history = JSON.parse(readFileSync(resolve(root, BASELINE_FILE), 'utf8'));
    console.info(JSON.stringify(Object.fromEntries(Object.keys(history.shards).map(slug => [slug, folderBuckets(join(out, slug))])), null, 1));
  } else {
    const measuresFile = flag('--measures');
    const dist = resolve(args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--measures') ?? 'dist');
    const downloads = readPhoneDownloads(dist);
    if (downloads === null) console.info(`shard size: ${dist} has no packs book; nothing to check`);
    else {
      const contentKeys = pinnedContentKeys(root), caps = readCaps(root);
      if (measuresFile !== undefined) writeFileSync(resolve(measuresFile), `${JSON.stringify(shardMeasures(downloads, contentKeys), null, 1)}\n`);
      if (args.includes('--record')) {
        const recorded = recordAll(caps, readBaselines(root), shardMeasures(downloads, contentKeys));
        for (const error of recorded.errors) console.error(error);
        if (recorded.errors.length === 0) writeBaselines(recorded.baselines, root);
      }
      const { errors, notes, rows } = checkShardSizes({ caps, baselines: readBaselines(root) }, downloads,
        { contentKeys, cooksAfter: args.includes('--cooks-after'), hardOnly: args.includes('--hard-only') });
      console.info(budgetTable(rows));
      for (const note of notes) console.info(note);
      for (const error of errors) console.error(error);
      if (errors.length > 0) process.exitCode = 1;
      else console.info(`shard size: ${Object.keys(downloads).length} products within their budgets`);
    }
  }
}
