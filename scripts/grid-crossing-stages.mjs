#!/usr/bin/env node
// GRID-CROSSING GC8: stage attribution from the crossing tour (`grid-crossing-tour.mjs`, its `prepare` per crossing). For each
// preparation span the page measured for the crossing's target (`wildshard.prepare:<slug>:<step>`, developer pages; the cell's
// instance in a step name reads `<cell>`), its wall time cold (the first crossing into that cell in a tour) and warm (a later
// one), and per crossing the main thread's long tasks and the bytes fetched under the target's shardfile folder (transfer
// size is 0 for a cache hit or a loopback page: decoded size beside it). Wall time,
// not CPU: spans overlap and include their awaits (preparationTiming.ts). Prints a markdown table.
//   node scripts/grid-crossing-stages.mjs <tour json or dir>,…
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(path => path.split(',')).filter(Boolean)
  .flatMap(path => statSync(path).isDirectory() ? readdirSync(path).filter(name => name.endsWith('-tour.json')).map(name => join(path, name)) : [path]);
if (files.length === 0) throw new Error('usage: grid-crossing-stages.mjs <tour json or dir>,…');
/** @type {Map<string, { cold: number[], warm: number[] }>} */
const steps = new Map();
/** @type {{ run: string, from: string, to: string, boost: boolean, cold: boolean, wallMs: number, longTasks: number, longTaskMs: number, bytes: number, decoded: number, files: number, slowest: string }[]} */
const crossings = [];
for (const file of files) {
  const tour = JSON.parse(readFileSync(file, 'utf8')), run = `${String(tour.engine)} ${String(tour.layout).split(' ')[0]}${tour.cold === true ? ' cold' : ''}`, seen = new Set(['driftwood-isle']);
  for (const crossing of tour.crossings ?? []) {
    const prepare = crossing.prepare; if (prepare === undefined) continue;
    // a `--cold` tour (no HTTP cache, no service worker) fetches every crossing as a first visit
    const cold = tour.cold === true || !seen.has(crossing.to); if (crossing.ok === true) seen.add(crossing.to);
    let slowest = '', slowestMs = -1;
    for (const [name, , ms] of prepare.spans ?? []) {
      const step = String(name).replaceAll(crossing.to, '<cell>');
      const row = steps.get(step) ?? { cold: [], warm: [] }; steps.set(step, row);
      (cold ? row.cold : row.warm).push(ms);
      if (ms > slowestMs) { slowestMs = ms; slowest = `${step} ${String(ms)} ms`; }
    }
    crossings.push({ run, from: crossing.from, to: crossing.to, boost: crossing.boost === true, cold, wallMs: crossing.wallMs ?? 0, longTasks: prepare.longTasks ?? 0,
      longTaskMs: prepare.longTaskMs ?? 0, bytes: prepare.bytes ?? 0, decoded: prepare.decodedBytes ?? 0, files: prepare.files ?? 0, slowest });
  }
}
const median = (/** @type {number[]} */ values) => { if (values.length === 0) return '-'; const sorted = [...values].sort((a, b) => a - b); return String(sorted[Math.floor(sorted.length / 2)]); };
const max = (/** @type {number[]} */ values) => values.length === 0 ? '-' : String(Math.max(...values));
console.log('| Step (span) | Cold n | Cold median ms | Cold max ms | Warm n | Warm median ms | Warm max ms |');
console.log('|---|---|---|---|---|---|---|');
for (const [step, row] of [...steps].sort((a, b) => Math.max(0, ...b[1].cold, ...b[1].warm) - Math.max(0, ...a[1].cold, ...a[1].warm))) {
  console.log(`| \`${step}\` | ${String(row.cold.length)} | ${median(row.cold)} | ${max(row.cold)} | ${String(row.warm.length)} | ${median(row.warm)} | ${max(row.warm)} |`);
}
console.log('\n| Run | Crossing | Cold | Wall ms | Long tasks (ms) | Files (transfer KB / decoded MB) | Slowest span |');
console.log('|---|---|---|---|---|---|---|');
for (const c of crossings) {
  console.log(`| ${c.run} | ${c.from} to ${c.to}${c.boost ? ' (boost)' : ''} | ${c.cold ? 'cold' : 'warm'} | ${String(c.wallMs)} | ${String(c.longTasks)} (${String(c.longTaskMs)}) | ${String(c.files)} (${String(Math.round(c.bytes / 1024))} / ${String(Math.round(c.decoded / 1048576))}) | ${c.slowest} |`);
}
