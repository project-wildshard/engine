#!/usr/bin/env node
// P1-E2: the engine ownership map's whole-tree census (lint/engine-sides.mjs). wildshard/engine-sides checks each
// linted file; this checks the tree: every non-test engine and game file is tagged, no file's edge count is above
// lint/engine-side-edges.json, and the recorded counts only fall.
//   node scripts/check-engine-sides.mjs            check (fails on an untagged file or a rise; warns on stale tags / falls)
//   node scripts/check-engine-sides.mjs --update   lower lint/engine-side-edges.json to today's counts, drop stale tags
//   node scripts/check-engine-sides.mjs --report   files / LOC per side, edge totals, the top violating folder pairs
//   node scripts/check-engine-sides.mjs --print    print the table --update would write and write nothing
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SIDES, SIDES_FILE, SIDE_EDGES_FILE, edgeTotals, readEdges, readSides, sideCensus } from '../lint/engine-sides.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
/** @param {any} value @returns {any} */
const sortKeys = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const EDGES_ABOUT = 'P1-E2: per-file counts of forbidden engine-side edges (lint/engine-sides.mjs): one per imported file on the wrong side, and in shared, server or cook one per renderer module and one per DOM global. wildshard/engine-sides refuses a count above these; scripts/check-engine-sides.mjs --update lowers them; they never rise (check-platform-ratchets).';

/** @param {string[]} argv */
function main(argv) {
  const rawSides = JSON.parse(readFileSync(SIDES_FILE, 'utf8')), sides = readSides(rawSides);
  const recorded = existsSync(SIDE_EDGES_FILE) ? readEdges(JSON.parse(readFileSync(SIDE_EDGES_FILE, 'utf8'))) : null;
  const census = sideCensus(ROOT, sides), failures = [], notes = [];
  for (const path of census.untagged) failures.push(`${path} has no side: add it to lint/engine-sides.json`);
  for (const path of census.stale) notes.push(`stale tag ${path} (no such file); drop it with --update`);
  const limits = recorded ?? {};
  for (const [path, edges] of Object.entries(census.counts)) for (const [edge, count] of Object.entries(edges)) {
    const was = limits[path]?.[edge] ?? 0;
    if (recorded !== null && count > was) failures.push(`${path} ${edge}: ${was} → ${count} (it may only fall)`);
  }
  for (const [path, edges] of Object.entries(limits)) for (const [edge, was] of Object.entries(edges)) {
    const now = census.counts[path]?.[edge] ?? 0;
    if (now < was) notes.push(`${path} ${edge} fell ${was} → ${now}; lower it with --update`);
  }
  if (argv.includes('--report')) report(census, sides);
  if (argv.includes('--update') || argv.includes('--print')) {
    if (failures.length > 0) { console.error(`check-engine-sides: refusing --update:\n  ${failures.join('\n  ')}`); return 1; }
    const files = sortKeys(Object.fromEntries(Object.entries(census.counts).map(([path, edges]) => [path, sortKeys(edges)])));
    const table = `${JSON.stringify({ about: EDGES_ABOUT, totals: edgeTotals(files), files }, null, 1)}\n`;
    if (argv.includes('--print')) { process.stdout.write(table); return 0; }
    writeFileSync(SIDE_EDGES_FILE, table);
    if (census.stale.length > 0) {
      for (const path of census.stale) delete rawSides.files[path];
      writeFileSync(SIDES_FILE, `${JSON.stringify(rawSides, null, 1)}\n`);
    }
    console.log(`check-engine-sides: recorded ${Object.keys(files).length} files with side edges; dropped ${census.stale.length} stale tags`);
    return 0;
  }
  for (const note of notes) console.warn(`check-engine-sides: ${note}`);
  if (recorded === null) failures.push('lint/engine-side-edges.json is missing: seed it with --update');
  if (failures.length > 0) { console.error(`check-engine-sides (P1-E2) failed:\n  ${failures.join('\n  ')}`); return 1; }
  const totals = edgeTotals(census.counts);
  console.log(`check-engine-sides: ${census.files.length} files tagged; ${Object.entries(totals).map(([edge, n]) => `${edge} ${n}`).join(', ')}; none rising`);
  return 0;
}

/** @param {any} census @param {any} sides */
function report(census, sides) {
  /** @param {string} path */
  const loc = path => readFileSync(resolve(ROOT, path), 'utf8').split('\n').filter(line => line.trim() !== '').length;
  const bySide = Object.fromEntries(SIDES.map(side => [side, { files: 0, loc: 0, mixedFiles: 0, mixedLoc: 0 }]));
  for (const path of census.files) {
    const entry = sides.get(path);
    if (entry === undefined) continue;
    const row = bySide[entry.side], n = loc(path);
    row.files++; row.loc += n;
    if (entry.mixed) { row.mixedFiles++; row.mixedLoc += n; }
  }
  console.log('Files and non-blank LOC per side:');
  for (const [side, row] of Object.entries(bySide)) console.log(`  ${side.padEnd(7)} ${String(row.files).padStart(5)} files ${String(row.loc).padStart(7)} LOC  (mixed: ${row.mixedFiles} files, ${row.mixedLoc} LOC)`);
  console.log('Edge totals:');
  for (const [edge, n] of Object.entries(edgeTotals(census.counts))) console.log(`  ${edge.padEnd(18)} ${n}`);
  /** @param {string} path */
  const folder = path => { const parts = path.replace(/^src\//u, '').split('/'); return parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0]; };
  const pairs = new Map();
  for (const unit of census.units) {
    const to = unit.unit.startsWith('src/') ? folder(unit.unit) : unit.edge.split(' → ')[1];
    const key = `${folder(unit.from)} → ${to}  (${unit.edge})`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  console.log('Top violating folder pairs:');
  for (const [key, n] of [...pairs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${key}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
