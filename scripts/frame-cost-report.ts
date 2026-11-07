#!/usr/bin/env node
/** FC7: derive a reproducible ranked table from the before-cut reader's raw frames.
 * GPU estimates and native timer queries are deliberately separate. No app state changes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as v from 'valibot';

const finite = v.pipe(v.number(), v.finite());
const frame = v.object({ phase: v.string(), interval: finite, update: finite, render: finite,
  buckets: v.array(finite), framebufferBinds: finite, calls: finite, triangles: finite });
const query = v.object({ phase: v.string(), label: v.string(), frame: finite,
  nanoseconds: v.nullable(v.pipe(finite, v.minValue(0))), disjoint: v.boolean(), unresolved: v.optional(v.boolean()) });
const identity = v.object({ url: v.string(), timeOrigin: finite, level: v.string(),
  canvas: v.optional(v.object({ width: finite, height: finite })) });
const capture = v.object({ initial: identity, final: identity, records: v.array(frame), queries: v.array(query),
  passCpu: v.array(v.object({ label: v.string(), ms: finite })),
  windows: v.array(v.object({ phase: v.string(), start: finite, end: finite })),
  extension: v.boolean(), timerBits: finite, disjoints: finite, skipped: finite, gpu: v.unknown() });
const schema = v.object({ protocol: v.literal('fc7-before/2'), pin: v.string(), version: v.object({ build: v.string() }),
  bucketNames: v.pipe(v.array(v.string()), v.minLength(1)),
  settings: v.object({ cpuRate: v.literal(4), fps: v.literal(30), tier: v.literal('phone'), quiet: v.boolean(), dpr: v.literal(2),
    viewport: v.object({ width: v.literal(402), height: v.literal(874) }) }),
  completed: v.boolean(), cases: v.array(v.object({ slug: v.string(), completed: v.optional(v.boolean()),
    errors: v.array(v.unknown()), failure: v.optional(v.unknown()), data: v.optional(capture) })) });

function stats(values: readonly number[]): { count: number; mean: number; p50: number; p95: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0 };
}
function shown(value: number | undefined): string { return value === undefined ? 'unavailable' : value.toFixed(2); }
const path = process.argv[2];
if (path === undefined) throw new Error('Usage: node scripts/frame-cost-report.ts <reading.json>');
const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
const reading = v.parse(schema, input);
if (!reading.completed || reading.cases.length === 0) throw new Error('Incomplete frame-cost cohort');
const names = reading.bucketNames;
if (new Set(names).size !== names.length || names.includes('other')) throw new Error('Invalid original bucket labels');
const table = ['| Shard | Frames | Main p50/p95 ms | Update/render mean ms | Top CPU buckets, mean ms | FBO binds/frame |',
  '|---|---:|---:|---:|---|---:|'];
const reports = reading.cases.map(row => {
  const data = row.data;
  if (!row.completed || data === undefined) throw new Error(`Incomplete reading: ${row.slug}`);
  if (data.initial.canvas?.width !== 804 || data.initial.canvas.height !== 1748) throw new Error(`Incorrect phone drawing buffer: ${row.slug}`);
  if (data.initial.timeOrigin !== data.final.timeOrigin || data.initial.url !== data.final.url
    || ![row.slug].includes(data.initial.level) || ![row.slug].includes(data.final.level)) throw new Error(`Document changed: ${row.slug}`);
  const frames = data.records.filter(record => record.phase === 'cpu-baseline');
  if (frames.length === 0 || frames.some(record => record.buckets.length !== names.length)) throw new Error(`Missing original bucket rows: ${row.slug}`);
  const main = stats(frames.map(record => record.update + record.render));
  const update = stats(frames.map(record => record.update)), render = stats(frames.map(record => record.render));
  const buckets = names.map((name, index) => ({ name, mean: stats(frames.map(record => record.buckets[index] ?? 0))?.mean ?? 0 }));
  buckets.push({ name: 'other', mean: stats(frames.map(record => Math.max(0, record.update - record.buckets.reduce((a, b) => a + b, 0))))?.mean ?? 0 });
  buckets.sort((a, b) => b.mean - a.mean);
  const valid = data.queries.flatMap(record => record.disjoint || record.unresolved || record.nanoseconds === null ? [] : [{ ...record, nanoseconds: record.nanoseconds }]);
  const whole = stats(valid.filter(record => record.phase === 'whole-query').map(record => record.nanoseconds / 1e6));
  const labels = [...new Set(data.passCpu.map(record => record.label))];
  const passes = labels.map(label => ({ label,
    gpu: stats(valid.filter(record => record.phase === 'pass-query' && record.label === label).map(record => record.nanoseconds / 1e6)),
    instrumentedCpu: stats(data.passCpu.filter(record => record.label === label).map(record => record.ms)) }));
  passes.sort((a, b) => (b.gpu?.mean ?? 0) - (a.gpu?.mean ?? 0));
  const knownPasses = passes.flatMap(pass => pass.gpu === null ? [] : [pass.gpu.mean]);
  const sum = knownPasses.length === passes.length && knownPasses.length > 0 ? knownPasses.reduce((total, value) => total + value, 0) : null;
  const queryRatio = sum !== null && whole !== null && whole.mean > 0 ? sum / whole.mean : null;
  const binds = stats(frames.map(record => record.framebufferBinds));
  const window = data.windows.find(record => record.phase === 'cpu-baseline');
  const fps = window === undefined ? null : frames.length * 1000 / (window.end - window.start);
  const report = { slug: row.slug, frames: frames.length, fps, main, update, render, buckets, framebufferBinds: binds,
    canvas: data.initial.canvas ?? null, gpuDevice: data.gpu,
    calls: stats(frames.map(record => record.calls)), triangles: stats(frames.map(record => record.triangles)),
    errors: row.errors.length, extension: data.extension, timerBits: data.timerBits, disjoints: data.disjoints,
    queries: data.queries.length, validQueries: valid.length, skipped: data.skipped, wholeComposerQuery: whole,
    passes, sumPassQueryMeans: sum, sumToWholeQueryRatio: queryRatio,
    queryQualification: 'Raw instrumented GPU elapsed queries; boundaries may perturb ANGLE Metal. Compare sum/whole ratio before using as a shipping GPU budget.' };
  table.push(`| ${row.slug} | ${frames.length} | ${shown(main?.p50)} / ${shown(main?.p95)} | ${shown(update?.mean)} / ${shown(render?.mean)} | ${buckets.slice(0, 3).map(bucket => `${bucket.name} ${shown(bucket.mean)}`).join(', ')} | ${shown(binds?.mean)} |`);
  return report;
});
const lines = [`Pin ${reading.pin}; build ${reading.version.build}.`,
  `Phone tier, ${reading.settings.fps} fps, Chromium CPU ${reading.settings.cpuRate}x; quiet=${reading.settings.quiet}.`, '', ...table, '',
  '| Shard | Whole-composer query mean ms | Per-pass GPU query means ms, descending | Sum / whole |', '|---|---:|---|---:|'];
for (const row of reports) lines.push(`| ${row.slug} | ${shown(row.wholeComposerQuery?.mean)} | ${row.passes.map(pass => `${pass.label}: ${shown(pass.gpu?.mean)} (n=${pass.gpu?.count ?? 0})`).join('; ')} | ${row.sumToWholeQueryRatio === null ? 'unavailable' : row.sumToWholeQueryRatio.toFixed(2)} |`);
lines.push('', 'GPU query values are instrumented timings, not an unperturbed physical-phone GPU measurement. The existing frameCost gpu~ inference is not substituted for query data. No Simulator CPU or energy reading is claimed.');
writeFileSync(join(dirname(path), 'summary.json'), `${JSON.stringify({ pin: reading.pin, build: reading.version.build, settings: reading.settings, bucketNames: names, reports }, null, 2)}\n`);
writeFileSync(join(dirname(path), 'table.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
