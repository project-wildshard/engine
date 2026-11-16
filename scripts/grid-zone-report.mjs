#!/usr/bin/env node
// ZONE-ENTRY ZE13: the zone tour's report (was GC3's grid-crossing-report). Reads one or more `grid-zone-tour.mjs` JSON files and
// writes one HTML page, cells × measures (entered, side, count start to control, the loading screen's time, playingMB at control),
// one table per tour. Exits 1 when a tour entered fewer cells than the ratchet asks or any measure is past it
// (`test/grid-zone-ratchet.json`), so a release can't quietly get slower or heavier at the gate.
//   node scripts/grid-zone-report.mjs <tour.json>... --out=<report.html> [--ratchet=test/grid-zone-ratchet.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as absolute } from 'node:path';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const files = process.argv.slice(2).filter(arg => !arg.startsWith('--')), out = flag('out', '');
if (files.length === 0 || out === '') throw new Error('usage: grid-zone-report.mjs <tour.json>... --out=<report.html> [--ratchet=<json>]');
/** @type {{ cells: number, countToControlMs: number, loadingMs: number, mb: number }} */
const ratchet = JSON.parse(readFileSync(absolute(flag('ratchet', 'test/grid-zone-ratchet.json')), 'utf8'));
const escape = (/** @type {string | number | boolean | null | undefined} */ value) => String(value ?? '–').replaceAll(/[&<>"]/gu, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
/** @type {string[]} */
const breaks = [];
const tables = files.map(file => {
  const tour = JSON.parse(readFileSync(absolute(file), 'utf8'));
  /** @type {any[]} */
  const entries = tour.entries ?? [];
  const entered = entries.filter(row => row.ok === true).length;
  if (entered < ratchet.cells) breaks.push(`${file}: ${String(entered)} cells entered, the ratchet asks ${String(ratchet.cells)}`);
  for (const row of entries) for (const key of /** @type {const} */ (['countToControlMs', 'loadingMs', 'mb'])) {
    if (typeof row[key] === 'number' && row[key] > ratchet[key]) breaks.push(`${file}: ${String(row.slug)} ${key} ${String(row[key])} > ${String(ratchet[key])}`);
  }
  const past = (/** @type {any} */ row, /** @type {'countToControlMs' | 'loadingMs' | 'mb'} */ key) => typeof row[key] === 'number' && row[key] > ratchet[key] ? ' class="past"' : '';
  const body = entries.map(row => `<tr><td>${escape(row.slug)}</td><td>${row.ok === true ? 'yes' : '<b class="past">no</b>'}</td><td>${escape(row.side)}</td>`
    + `<td${past(row, 'countToControlMs')}>${escape(row.countToControlMs)}</td><td${past(row, 'loadingMs')}>${escape(row.loadingMs)}</td><td${past(row, 'mb')}>${escape(row.mb)}</td></tr>`).join('\n');
  return `<h2>${escape(tour.engine)} ${escape(tour.viewport)} · build ${escape(tour.build)} · ${String(entered)} of ${String(entries.length)} entered</h2>
<table><thead><tr><th>cell</th><th>entered</th><th>side</th><th>count to control (ms)</th><th>loading (ms)</th><th>playingMB</th></tr></thead><tbody>
${body}
</tbody></table>${(tour.errors ?? []).length === 0 ? '' : `<p class="past">page errors: ${escape((tour.errors ?? []).join(' | '))}</p>`}`;
});
writeFileSync(absolute(out), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zone tour</title>
<style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:right}td:first-child,th:first-child{text-align:left}.past{color:#b00020}</style>
<h1>Zone tour</h1><p>Ratchet: ${String(ratchet.cells)} cells, count to control ≤ ${String(ratchet.countToControlMs)} ms, loading ≤ ${String(ratchet.loadingMs)} ms, playingMB ≤ ${String(ratchet.mb)}.</p>
${tables.join('\n')}${breaks.length === 0 ? '' : `<h2 class="past">Past the ratchet</h2><ul>${breaks.map(line => `<li>${escape(line)}</li>`).join('')}</ul>`}\n`);
for (const line of breaks) console.log(`RATCHET ${line}`);
console.log(`${out}: ${String(files.length)} tour(s), ${String(breaks.length)} past the ratchet`);
process.exit(breaks.length === 0 ? 0 : 1);
