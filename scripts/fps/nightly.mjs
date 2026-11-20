#!/usr/bin/env node
// DF7. Grade one pinned full-route table and compare p95 with a qualified night.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readCaps } from '../budgets/files.mjs';

const zone = 'driftwood-isle';
const profiles = ['phone-low', 'phone-lpm-low', 'phone-high', 'desktop-high', 'desktop-native'];
const variants = [1, 1, 1, 2, 4];
const repeatCount = 3;
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** @typedef {{version?:{ build:string }, witness?:{ build:string, gpu:string|null }, verdict:string,
 * overall?:{ metrics:{ fps:number, p95:number } }|null}} Capture */
/** @typedef {{name:string, rep:number, profile:{width:number,height:number,dpr:number,graphics:string,cap:number|null,
 * cpu:number, floor:number, calibrated:boolean}, cold:Capture, warm:Capture|null}} Run */
/** @typedef {{scope:string,zone:string,host:string,runs:Run[]}} Table */
/** @typedef {{name:string, gap:number, fps:number, floor:number, p95:number, misses:string[], factors:string}} Result */
/** @typedef {{host:string, gpu:string|null, qualifies:boolean, rows:Result[]}} Receipt */

/** @param {Table} table @param {string} build @param {Receipt|null} [previous] */
export function reviewNight(table, build, previous = null) {
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
    const factors = [...new Set(set.map(run => [
      run.profile.width, run.profile.height, run.profile.dpr, run.profile.graphics, run.profile.cap, run.profile.cpu,
    ].join('/')))].sort((a, b) => a.localeCompare(b)).join(', ');
    const misses = [];
    if (set.length !== variants[idx] * repeatCount || set.some(run =>
      run.profile.floor !== floor || !run.profile.calibrated || run.cold.verdict === 'incomplete' ||
      (run.rep === repeatCount && (run.warm === null || run.warm.verdict === 'incomplete')))) misses.push('incomplete or uncalibrated');
    if (set.some(run => run.cold.verdict === 'miss')) misses.push('floor');
    const last = previous?.qualifies && previous.host === table.host && previous.gpu === gpu
      ? previous.rows.find(row => row.name === name && row.factors === factors && row.floor === floor) : undefined;
    if (last !== undefined && p95 > last.p95 * 1.1) misses.push(`p95 +${((p95 / last.p95 - 1) * 100).toFixed(1)}%`);
    return [{name, gap: fps - floor, fps, floor, p95, misses, factors}];
  });
  const missing = profiles.filter(name => !rows.some(row => row.name === name));
  const qualifies = exact && hardware && missing.length === 0 && rows.every(row => row.misses.length === 0);
  return {build, host:table.host, gpu, hardware, exact, missing, qualifies, rows};
}

/** @param {ReturnType<typeof reviewNight>} report @param {boolean} gate */
function summary(report, gate) {
  const heading = `### DF7 ${gate ? 'qualification' : 'report only until DF15'}`;
  const errors = [
    ...report.exact ? [] : ['Missing the full route from the exact commit.'],
    ...report.hardware ? [] : ['A hardware Metal renderer was not identified.'],
    ...report.missing.length === 0 ? [] : [`Missing profiles ${report.missing.join(', ')}.`],
  ];
  return [heading, '', `Build ${report.build} · ${report.host ?? 'unknown host'} · ${report.gpu ?? 'unknown GPU'}`, '',
    '| Profile | Floor | Worst cold FPS | Gap | Worst cold p95 ms | Verdict |',
    '|---|---:|---:|---:|---:|---|',
    ...report.rows.map(row => `| ${row.name} | ${row.floor} | ${row.fps.toFixed(2)} | ${row.gap.toFixed(2)} | ${row.p95.toFixed(2)} | ${row.misses.length > 0 ? row.misses.join(', ') : 'pass'} |`),
    '', ...errors, report.qualifies ? 'Qualified.' : 'Qualification pending.', '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{
    table:{type:'string'}, build:{type:'string'}, previous:{type:'string'}, out:{type:'string'}, gate:{type:'boolean',default:false},
  }});
  if (!values.table || !values.build || !values.out) throw new Error('Supply --table, --build and --out');
  const report = reviewNight(read(values.table), values.build, values.previous ? read(values.previous) : null);
  writeFileSync(values.out, `${JSON.stringify(report,null,2)}\n`);
  const markdown = summary(report, values.gate);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  if (values.gate && !report.qualifies) process.exitCode = 2;
}
