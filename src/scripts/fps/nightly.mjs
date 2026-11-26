#!/usr/bin/env node
// DF7. Grade one pinned full-route table and compare p95 with a qualified night.
//   node src/scripts/fps/nightly.mjs --table T --build SHA --out night.json [--previous night.json] [--since SHA] [--gate]
//   node src/scripts/fps/nightly.mjs --receipt night.json [--gate]   the hosted report job: print a night the mini measured
// The Mac mini measures (src/scripts/fps/nightly-mini.mjs) and the hosted driftwood-fps.yml job prints its night.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readCaps } from '../budgets/files.mjs';

const zone = 'driftwood-isle';
const profiles = ['phone-low', 'phone-lpm-low', 'phone-high', 'desktop-medium', 'desktop-native'];
/** DF15: the profiles a night's verdict counts (all five). A profile left out still measures and prints, marked report
 *  only: its misses and absence do not stop the night qualifying, and the p95 comparison uses gated-green nights. */
export const GATED_PROFILES = profiles;
const variants = [1, 1, 1, 2, 4];
const repeatCount = 3;
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** @typedef {{version?:{ build:string }, witness?:{ build:string, gpu:string|null }, verdict:string,
 * overall?:{ metrics:{ fps:number, p95:number } }|null}} Capture */
/** @typedef {{name:string, rep:number, profile:{width:number,height:number,dpr:number,graphics:string,cap:number|null,
 * cpu:number, floor:number, calibrated:boolean}, cold:Capture, warm:Capture|null}} Run */
/** @typedef {{scope:string,zone:string,host:string,runs:Run[]}} Table */
/** @typedef {{name:string, gap:number, fps:number, floor:number, p95:number, misses:string[], factors:string, gated:boolean}} Result */
/** @typedef {{build?:string, host:string, gpu:string|null, hardware?:boolean, exact?:boolean, missing?:string[],
 * qualifies:boolean, since?:string|null, rows:Result[]}} Receipt */

/** @param {Table} table @param {string} build @param {Receipt|null} [previous] @param {readonly string[]} [gated] */
export function reviewNight(table, build, previous = null, gated = GATED_PROFILES) {
  const caps = readCaps();
  const { runs } = table;
  const captures = runs.flatMap(run => run.warm === null ? [run.cold] : [run.cold, run.warm]);
  const gpus = new Set(captures.map(capture => capture.witness?.gpu ?? null));
  const gpu = gpus.size === 1 ? [...gpus][0] ?? null : null;
  const hardware = typeof gpu === 'string' && /metal/iu.test(gpu) && !/swiftshader|software/iu.test(gpu);
  const exact = captures.length > 0 && table.scope === 'route' && table.zone === zone && captures.every(c =>
    c.version?.build === build && c.witness?.build === build);
  const rows = profiles.flatMap((name, idx) => {
    const floor = caps.caps[`fps/${name}/${zone}`].hard;
    const set = runs.filter(run => run.name === name);
    const observed = set.flatMap(run => run.cold.overall ? [run.cold.overall.metrics] : []);
    if (observed.length === 0 || floor === null) return [];
    const fps = Math.min(...observed.map(row => row.fps));
    const p95 = Math.max(...observed.map(row => row.p95));
    /** @type {Map<string, number[]>} */
    const repeats = new Map();
    for (const {profile, rep} of set) {
      const variant = [profile.width, profile.height, profile.dpr, profile.graphics, profile.cap, profile.cpu].join('/');
      const seen = repeats.get(variant) ?? [];
      seen.push(rep);
      repeats.set(variant, seen);
    }
    const factors = [...repeats.keys()].sort((a, b) => a.localeCompare(b)).join(', ');
    const fullMatrix = repeats.size === variants[idx] && [...repeats.values()].every(seen =>
      seen.length === repeatCount && new Set(seen).size === repeatCount && seen.every(rep =>
        Number.isInteger(rep) && rep >= 1 && rep <= repeatCount));
    const misses = [];
    if (!fullMatrix || set.some(run =>
      run.profile.floor !== floor || !run.profile.calibrated || run.cold.verdict === 'incomplete' ||
      (run.rep === repeatCount && (run.warm === null || run.warm.verdict === 'incomplete')))) misses.push('incomplete or uncalibrated');
    if (set.some(run => run.cold.verdict === 'miss')) misses.push('floor');
    const last = previous?.qualifies && previous.host === table.host && previous.gpu === gpu
      ? previous.rows.find(row => row.name === name && row.factors === factors && row.floor === floor) : undefined;
    if (last !== undefined && p95 > last.p95 * 1.1) misses.push(`p95 +${((p95 / last.p95 - 1) * 100).toFixed(1)}%`);
    return [{name, gap: fps - floor, fps, floor, p95, misses, factors, gated: gated.includes(name)}];
  });
  const missing = profiles.filter(name => gated.includes(name) && !rows.some(row => row.name === name));
  const qualifies = exact && hardware && missing.length === 0 && rows.every(row => !row.gated || row.misses.length === 0);
  return {build, host:table.host, gpu, hardware, exact, missing, qualifies, rows};
}

/** A night from the mini, as the hosted job receives it: the shape summary() prints, or a throw.
 * @param {unknown} value @returns {ReturnType<typeof reviewNight> & {since?:string|null}} */
export function checkedReceipt(value) {
  const night = /** @type {Record<string, unknown>} */ (value);
  const sha = (/** @type {unknown} */ v) => typeof v === 'string' && /^[0-9a-f]{7,40}$/u.test(v);
  const ok = typeof night === 'object' && night !== null && sha(night.build) && (night.since === undefined || night.since === null || sha(night.since)) &&
    typeof night.qualifies === 'boolean' && Array.isArray(night.rows) && Array.isArray(night.missing) &&
    night.rows.every(row => typeof row === 'object' && row !== null && profiles.includes(row.name) &&
      ['gap', 'fps', 'floor', 'p95'].every(key => typeof row[key] === 'number') && Array.isArray(row.misses));
  if (!ok) throw new Error('not a DF7 night (nightly.mjs --out)');
  // a night from before DF15's gated set counted every profile (the rows are this parse's own)
  for (const row of /** @type {Record<string, unknown>[]} */ (night.rows)) row.gated = row.gated !== false;
  return /** @type {ReturnType<typeof reviewNight> & {since?:string|null}} */ (night);
}

/** @param {ReturnType<typeof reviewNight> & {since?:string|null}} report @param {boolean} gate */
export function summary(report, gate) {
  const heading = `### DF7 ${gate ? 'qualification' : 'report only until DF15'}`;
  const errors = [
    ...report.exact ? [] : ['Missing the full route from the exact commit.'],
    ...report.hardware ? [] : ['A hardware Metal renderer was not identified.'],
    ...report.missing.length === 0 ? [] : [`Missing profiles ${report.missing.join(', ')}.`],
  ];
  const since = report.since ? ` · since the last green night ${report.since.slice(0, 10)}` : '';
  return [heading, '', `Build ${report.build} · ${report.host ?? 'unknown host'} · ${report.gpu ?? 'unknown GPU'}${since}`, '',
    '| Profile | Floor | Worst cold FPS | Gap | Worst cold p95 ms | Verdict |',
    '|---|---:|---:|---:|---:|---|',
    ...report.rows.map(row => `| ${row.name} | ${row.floor} | ${row.fps.toFixed(2)} | ${row.gap.toFixed(2)} | ${row.p95.toFixed(2)} | ${row.misses.length > 0 ? row.misses.join(', ') : 'pass'}${row.gated ? '' : ' (report only)'} |`),
    '', ...errors, report.qualifies ? 'Qualified.' : 'Qualification pending.', '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{
    table:{type:'string'}, build:{type:'string'}, previous:{type:'string'}, out:{type:'string'}, gate:{type:'boolean',default:false},
    since:{type:'string'}, receipt:{type:'string'},
  }});
  /** @type {ReturnType<typeof reviewNight> & {since?:string|null}} */
  let report;
  if (values.receipt) report = checkedReceipt(read(values.receipt));
  else {
    if (!values.table || !values.build || !values.out) throw new Error('Supply --table, --build and --out (or --receipt)');
    report = {...reviewNight(read(values.table), values.build, values.previous ? read(values.previous) : null), since:values.since ?? null};
    writeFileSync(values.out, `${JSON.stringify(report,null,2)}\n`);
  }
  const markdown = summary(report, values.gate);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  if (values.gate && !report.qualifies) process.exitCode = 2;
}
