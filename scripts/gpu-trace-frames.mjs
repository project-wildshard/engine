#!/usr/bin/env node
// op-hitch47: attribute a frame-floor drive's long frames from its Chrome trace (`frame-floor.mjs --gpu-trace=<dir>`).
// node scripts/gpu-trace-frames.mjs <dir>/<plan>-<time>.json [--min=50] [--top=12]
// For each long frame (> --min ms, from the sidecar <plan>-<time>.frames.json, page clock), mapped onto the trace clock by
// the `frameFloorTraceAnchor` user-timing mark, prints the runtime hook it overlapped and, per process thread (GPU main,
// renderer main, compositor, viz), the busiest event names inside the window by self time (time not inside a child event) and count.
// Diagnostic only: no timing credit.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (file === undefined) throw new Error('usage: node scripts/gpu-trace-frames.mjs <trace.json> [--min=50] [--top=12]');
const flag = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
const minMs = flag('min', 50), top = flag('top', 12);
const side = JSON.parse(readFileSync(file.replace(/\.json$/u, '.frames.json'), 'utf8'));
const raw = JSON.parse(readFileSync(file, 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

const processNames = new Map(), threadNames = new Map();
for (const e of events) {
  if (e.ph !== 'M') continue;
  if (e.name === 'process_name') processNames.set(e.pid, e.args.name);
  if (e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args.name);
}
const anchor = events.find((e) => e.name === 'frameFloorTraceAnchor' && e.ts !== undefined);
if (anchor === undefined) throw new Error('trace has no frameFloorTraceAnchor mark');
// trace µs for a page-clock ms
const toTrace = (pageMs) => anchor.ts + (pageMs - side.anchorPageMs) * 1000;

// complete spans per thread: X events and matched B/E pairs
const spans = [];
const open = new Map();
for (const e of events) {
  if (e.ph === 'X' && typeof e.dur === 'number') spans.push({ key: `${e.pid}:${e.tid}`, name: e.name, start: e.ts, end: e.ts + e.dur });
  else if (e.ph === 'B') { const k = `${e.pid}:${e.tid}`; const stack = open.get(k) ?? []; stack.push(e); open.set(k, stack); }
  else if (e.ph === 'E') { const k = `${e.pid}:${e.tid}`; const b = open.get(k)?.pop(); if (b) spans.push({ key: k, name: b.name, start: b.ts, end: e.ts }); }
}
spans.sort((a, b) => a.start - b.start || b.end - a.end);
// self intervals: each span's time not covered by a child on its thread (the leaf that really ran)
const selfOf = new Map();
{
  const stacks = new Map();
  for (const s of spans) {
    const stack = stacks.get(s.key) ?? []; stacks.set(s.key, stack);
    while (stack.length > 0 && (stack.at(-1)?.end ?? 0) <= s.start) stack.pop();
    const parent = stack.at(-1);
    if (parent !== undefined) (selfOf.get(parent) ?? selfOf.set(parent, []).get(parent)).push([s.start, Math.min(s.end, parent.end)]);
    stack.push(s);
  }
}
/** a span's self time inside [t0, t1], µs */
const selfIn = (s, t0, t1) => {
  let a = Math.max(s.start, t0), total = 0;
  const end = Math.min(s.end, t1);
  for (const [c0, c1] of selfOf.get(s) ?? []) { if (c1 <= a) continue; if (c0 >= end) break; if (c0 > a) total += c0 - a; a = Math.max(a, c1); }
  if (end > a) total += end - a;
  return total;
};
// JS samples (disabled-by-default-v8.cpu_profiler): per thread, [trace µs, leaf node id], with each profile's node table
const profiles = new Map();
for (const e of events) {
  if (e.name === 'Profile') profiles.set(`${e.pid}:${e.id}`, { key: `${e.pid}:${e.tid}`, t: e.args.data.startTime, nodes: new Map(), samples: [] });
  else if (e.name === 'ProfileChunk') {
    const p = profiles.get(`${e.pid}:${e.id}`), d = e.args.data;
    if (p === undefined) continue;
    for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
    const samples = d.cpuProfile?.samples ?? [], deltas = d.timeDeltas ?? [];
    for (let i = 0; i < samples.length; i++) { p.t += deltas[i] ?? 0; p.samples.push([p.t, samples[i]]); }
  }
}
const frameName = (n) => { const f = n?.callFrame; return f === undefined ? '?' : `${f.functionName === '' || f.functionName === undefined ? '(anonymous)' : f.functionName} ${String(f.url ?? '').split('/').pop()}:${(f.lineNumber ?? -1) + 1}:${(f.columnNumber ?? -1) + 1}`; };
/** the JS in [t0, t1] on `key`'s thread: self and inclusive ms by frame (each sample counts its gap to the next) */
function jsIn(key, t0, t1) {
  const self = new Map(), inclusive = new Map();
  for (const p of profiles.values()) {
    if (p.key !== key) continue;
    for (let i = 0; i < p.samples.length - 1; i++) {
      const [at, id] = p.samples[i], next = p.samples[i + 1][0];
      if (next <= t0 || at >= t1) continue;
      const ms = (Math.min(next, t1) - Math.max(at, t0)) / 1000, leaf = p.nodes.get(id);
      self.set(frameName(leaf), (self.get(frameName(leaf)) ?? 0) + ms);
      const seen = new Set();
      for (let n = leaf; n !== undefined; n = p.nodes.get(n.parent)) { const k = frameName(n); if (seen.has(k)) continue; seen.add(k); inclusive.set(k, (inclusive.get(k) ?? 0) + ms); }
    }
  }
  return { self, inclusive };
}
const label = (key) => { const [pid] = key.split(':'); return `${processNames.get(Number(pid)) ?? pid} / ${threadNames.get(key) ?? key}`; };

for (const [startMs, ms] of side.longFrames) {
  if (ms < minMs) continue;
  const t0 = toTrace(startMs), t1 = t0 + ms * 1000;
  const hook = side.hooks.find((h) => startMs < h.end && startMs + ms > h.start);
  console.log(`\n=== frame at ${startMs.toFixed(0)} ms, ${ms} ms — ${hook ? `${hook.instance}:${hook.hook}` : 'between hooks'}`);
  const byThread = new Map();
  for (const s of spans) {
    if (s.start >= t1) break;
    if (s.end <= t0) continue;
    const overlap = selfIn(s, t0, t1) / 1000;
    if (overlap < 0.3) continue;
    const names = byThread.get(s.key) ?? new Map();
    const row = names.get(s.name) ?? { ms: 0, n: 0, max: 0 };
    row.ms += overlap; row.n++; row.max = Math.max(row.max, (s.end - s.start) / 1000); names.set(s.name, row); byThread.set(s.key, names);
  }
  const threads = [...byThread.entries()].map(([key, names]) => ({ key, names, busiest: Math.max(...[...names.values()].map((r) => r.ms)) })).sort((a, b) => b.busiest - a.busiest).slice(0, Number(process.env.TRACE_THREADS ?? 6));
  for (const { key, names } of threads) {
    console.log(`  ${label(key)}`);
    for (const [name, r] of [...names.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, top)) console.log(`    ${r.ms.toFixed(1).padStart(7)} ms  ×${String(r.n).padEnd(4)} max ${r.max.toFixed(1).padStart(6)}  ${name}`);
    const js = jsIn(key, t0, t1);
    const show = (map, kind) => { for (const [name, jsMs] of [...map].filter(([n]) => !/^\((root|program|idle)\)/u.test(n)).sort((x, y) => y[1] - x[1]).slice(0, top)) console.log(`      js ${kind} ${jsMs.toFixed(1).padStart(6)} ms  ${name}`); };
    if (js.self.size > 0) { show(js.self, 'self'); show(js.inclusive, 'incl'); }
  }
}
