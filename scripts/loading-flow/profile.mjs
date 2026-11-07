#!/usr/bin/env node
// DL23 / DL10: what runs inside each long loading frame. Reads a `drive.mjs --profile` run (<mode>-profile.json: WebKit
// ScriptProfiler samples from the world page's first poll to control, and <mode>-timeline.jsonl: the page's frame stamps)
// and lists, for every loading frame over 250 ms, the sampled functions inside it: by self time (the innermost frame) and
// by inclusive time (anywhere on the stack). Few samples inside a long frame means the main thread was free and the frame
// waited elsewhere (the GPU process).
//   node scripts/loading-flow/profile.mjs <run-dir> [cold|warm|upgrade]   # prints; writes <run-dir>/<mode>-profile-frames.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LONG_MS = 250, TOP = 8;

/** Per long frame: samples inside it and the functions that hold it. `rows` are the timeline rows, `profile` the dump. */
export function profileFrames(rows, profile) {
  const { calibration, samples } = profile;
  const firstS = samples[0]?.t ?? 0;
  // the profiler's seconds onto the page's performance.now: its start against the page clock read beside it
  const pageMs = (t) => calibration.pageMs + (t - (calibration.profilerS ?? firstS)) * 1000;
  const control = rows.find(row => row.ev === 'control')?.t ?? Infinity;
  const gaps = [];
  let last = null;
  for (const row of rows) {
    if (row.ev !== 'frames' || row.origin !== calibration.origin) continue;
    for (const at of row.f) {
      if (last !== null && at - last > LONG_MS && at >= calibration.pageMs && row.origin + at <= control) gaps.push({ from: last, to: at, ms: Math.round(at - last) });
      last = at;
    }
  }
  const timed = samples.map(sample => ({ at: pageMs(sample.t), frames: sample.frames }));
  const name = (frame) => `${frame[0]} ${frame[1]}:${frame[2]}`;
  const top = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([fn, n]) => ({ fn, samples: n }));
  return gaps.map(gap => {
    const inside = timed.filter(sample => sample.at >= gap.from && sample.at <= gap.to);
    const self = new Map(), inclusive = new Map();
    for (const sample of inside) {
      const innermost = sample.frames[0];
      if (innermost !== undefined) self.set(name(innermost), (self.get(name(innermost)) ?? 0) + 1);
      for (const fn of new Set(sample.frames.map(name))) inclusive.set(fn, (inclusive.get(fn) ?? 0) + 1);
    }
    return { fromPageMs: Math.round(gap.from), ms: gap.ms, samples: inside.length, self: top(self), inclusive: top(inclusive) };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, mode = 'cold'] = process.argv.slice(2);
  if (!dir) { console.error('usage: profile.mjs <run-dir> [cold|warm|upgrade]'); process.exit(2); }
  const rows = readFileSync(join(dir, `${mode}-timeline.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = profileFrames(rows, JSON.parse(readFileSync(join(dir, `${mode}-profile.json`), 'utf8')));
  for (const frame of result) {
    console.log(`${frame.ms} ms frame at page ${frame.fromPageMs} ms: ${frame.samples} samples`);
    for (const row of frame.inclusive) console.log(`  ${String(row.samples).padStart(4)}  ${row.fn}`);
  }
  writeFileSync(join(dir, `${mode}-profile-frames.json`), `${JSON.stringify(result, null, 1)}\n`);
}
