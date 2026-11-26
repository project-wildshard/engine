#!/usr/bin/env node
// phone-fit.mjs (ENGINE-MEMORY EM11): refit src/scripts/memory/phone-model.json from runs on the Mac.
//
//   node src/scripts/memory/phone-fit.mjs --anchor=<measure.mjs JSON of the build the phone died on> --last=compile:after
//        --zones=<measure.mjs JSON>,... --chromium=<boot-memory-peak.mjs JSON>,... [--out=src/scripts/memory/phone-model.json]
//   node src/scripts/memory/phone-fit.mjs --staircase=<17 Pro nominal allocation JSON> [--out=...]
//   node src/scripts/memory/phone-fit.mjs --device=iPhone14,5   show report-only fit inputs and status (IP11)
//
// The anchor run must carry the boot trace's windows (measure.mjs records them as `traceCheckpoints`). Each zone needs
// three or more native WebKit runs with the ledger counters at control, and one or more Chromium probe runs of the same
// build. What each number means: src/scripts/memory/phoneModel.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { anchorBounds, ledgerSplit, loadPhoneModel, phoneFromWebKit, phonePeakFromWebKit } from './phoneModel.mjs';
import { KINDS, MB } from './calibration.mjs';
import { stats } from './measure.mjs';

const median = (/** @type {number[]} */ xs) => stats(xs).median;
/** The anchor's own Chromium renderer loading peaks, MB (mini-memcal 2026-11-17: v0.1.36 + Nine rev 2, Low, at "boot plan
 *  complete / compile:after"). The phone died there, so the Chromium reader's central factor never puts the lowest of
 *  them under the limit, whatever the zones' ratio (EM11b: clean zone peaks put that ratio at 1.9, the anchor at 2.09). */
export const ANCHOR_RENDERER_MB = Object.freeze([1029, 1061, 1063]);

/** Least squares y = floor + perMB x. @param {readonly [number, number][]} points MB pairs */
export function lineFit(points) {
  const n = points.length, mx = points.reduce((s, p) => s + p[0], 0) / n, my = points.reduce((s, p) => s + p[1], 0) / n;
  const sxx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const perMB = sxx === 0 ? 0 : sxy / sxx;
  return { floorMB: my - perMB * mx, perMB };
}

/** One zone's medians over its WebKit runs. @param {any[]} runs measure.mjs `webkit` rows */
export function zoneSummary(runs) {
  const ok = runs.filter((r) => r.ready && r.settled && !r.refused);
  if (ok.length === 0) throw new Error('no valid WebKit run');
  const ledger = ok.map((r) => ledgerSplit(r.counters));
  return { runs: ok.length, chunk: ok[0].chunk, build: ok[0].build,
    settled: { webcontent: median(ok.map((r) => r.settled.webcontent)), gpu: median(ok.map((r) => r.settled.gpu)) },
    ledger: { ram: median(ledger.map((l) => l.ram)), gpu: median(ledger.map((l) => l.gpu)) },
    checkpoints: ok.map((r) => r.checkpoints) };
}

/** Fit the model. @param {{anchor:any[], last:string, zones:any[][], chromium:Record<string, number[]>, limitMB:number, limitHighMB:number, gpuFloorMB:number, anchorRendererMB?:readonly number[]}} input */
export function fitPhoneModel({ anchor, last, zones, chromium, limitMB, limitHighMB, gpuFloorMB, anchorRendererMB = ANCHOR_RENDERER_MB }) {
  // EM11b: every run read with one inspector mode (a run before measure.mjs named it is `full`)
  const modes = [...new Set([...anchor, ...zones.flat()].map((r) => r.instrument ?? 'full'))];
  if (modes.length !== 1) throw new Error(`the runs mix inspector modes (${modes.join(', ')}): refit on one`);
  // STR1: and on one boot (a run before STR1 is `standalone`)
  const boots = [...new Set([...anchor, ...zones.flat()].map((r) => r.boot ?? 'standalone'))];
  if (boots.length !== 1) throw new Error(`the runs mix boots (${boots.join(', ')}): refit on one`);
  const bounds = anchor.filter((r) => (r.traceCheckpoints ?? []).length > 0).map((r) => anchorBounds(r.traceCheckpoints, last, { limitMB, limitHighMB, gpuFloorMB }));
  if (bounds.length === 0) throw new Error('the anchor has no run with boot trace windows');
  const pick = (/** @type {(b: ReturnType<typeof anchorBounds>) => number} */ f) => Math.round(median(bounds.map(f)) * 1000) / 1000;
  const model = { limitMB, limitHighMB, gpuFloorMB,
    alpha: { low: pick((b) => b.alpha.low), high: pick((b) => b.alpha.high) }, scale: { low: pick((b) => b.scale.low), high: pick((b) => b.scale.high) } };
  const summaries = zones.map(zoneSummary);
  const rows = summaries.map((z) => {
    const settled = phoneFromWebKit(z.settled, model);
    const peaks = z.checkpoints.map((cps) => phonePeakFromWebKit(cps, model));
    const peak = { low: median(peaks.map((p) => p.low)), central: median(peaks.map((p) => p.central)), high: median(peaks.map((p) => p.high)) };
    const renderer = chromium[z.chunk] ?? [];
    return Object.assign(z, { settledPhone: settled, peakPhone: peak, rendererLoadingPeak: renderer.length > 0 ? median(renderer) : null });
  });
  const wc = lineFit(rows.map((r) => [r.ledger.ram / MB, r.settled.webcontent / MB])), gp = lineFit(rows.map((r) => [r.ledger.gpu / MB, r.settled.gpu / MB]));
  // leave-one-out: each zone predicted from the others' fit, as the phone's central figure
  const misses = rows.map((r, i) => {
    const rest = rows.filter((_, j) => j !== i), w = lineFit(rest.map((x) => [x.ledger.ram / MB, x.settled.webcontent / MB])), g = lineFit(rest.map((x) => [x.ledger.gpu / MB, x.settled.gpu / MB]));
    const p = phoneFromWebKit({ webcontent: (w.floorMB + w.perMB * r.ledger.ram / MB) * MB, gpu: (g.floorMB + g.perMB * r.ledger.gpu / MB) * MB }, model);
    return Math.abs(p.central - r.settledPhone.central) / r.settledPhone.central;
  });
  const ratios = rows.map((r) => r.peakPhone.central / r.settledPhone.central);
  const withR = rows.filter((r) => r.rendererLoadingPeak !== null);
  const round = (/** @type {number} */ x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
  return { ...model, instrument: modes[0], boot: boots[0],
    ledger: { webcontent: { floorMB: round(wc.floorMB, 1), perMB: round(wc.perMB) }, gpu: { floorMB: round(gp.floorMB, 1), perMB: round(gp.perMB) }, missPct: round(Math.max(...misses) * 100, 1) },
    peakOverSettled: { low: round(Math.min(...ratios)), central: round(median(ratios)), high: round(Math.max(...ratios)) },
    chromium: withR.length === 0 ? null : chromiumBar(withR, limitMB / Math.min(...anchorRendererMB), round),
    anchor: { last, runs: bounds.length, died: bounds.map((b) => b.died), lived: bounds.map((b) => b.lived), consistent: bounds.every((b) => b.consistent) },
    zones: Object.fromEntries(rows.map((r) => [r.chunk, { build: r.build, runs: r.runs, settledMB: { webcontent: round(r.settled.webcontent / MB, 0), gpu: round(r.settled.gpu / MB, 0) },
      ledgerMB: { ram: round(r.ledger.ram / MB, 1), gpu: round(r.ledger.gpu / MB, 1) },
      phonePlayingMB: Object.fromEntries(Object.entries(r.settledPhone).map(([k, v]) => [k, round(v / MB, 0)])),
      phoneLoadingMB: Object.fromEntries(Object.entries(r.peakPhone).map(([k, v]) => [k, round(v / MB, 0)])),
      chromiumLoadingRendererMB: r.rendererLoadingPeak === null ? null : round(r.rendererLoadingPeak / MB, 0) }])) };
}

/** The Chromium reader's bar: the zones' phone loading peak over their renderer peak, its central held at or over the
 *  anchor's floor. @param {any[]} rows @param {number} floor @param {(x: number) => number} round */
function chromiumBar(rows, floor, round) {
  const central = Math.max(median(rows.map((r) => r.peakPhone.central / r.rendererLoadingPeak)), floor);
  const high = Math.max(Math.max(...rows.map((r) => r.peakPhone.high / r.rendererLoadingPeak)), central);
  return { loadingPerRenderer: { low: round(Math.min(...rows.map((r) => r.peakPhone.low / r.rendererLoadingPeak))), central: round(central), high: round(high) } };
}

/** The last completed nominal sizes, against the existing process line.
 * A single phone tour gives effective factors, not per-kind process limits.
 * @param {{source:string, processLineBytes:number, lastCompletedMB:Record<string,number>}} evidence
 * @param {{limitMB:number, limitHighMB:number}} model */
function fitStaircase(evidence, model) {
  const { source, processLineBytes, lastCompletedMB } = evidence;
  const lineMB = Math.round(processLineBytes / MB);
  if (!source || !Number.isSafeInteger(processLineBytes) || lineMB !== model.limitMB || lineMB !== model.limitHighMB)
    throw new Error('staircase must use the fitted 17 Pro process line');
  const effectiveFactors = Object.fromEntries(KINDS.filter(kind => kind !== 'none').map(kind => {
    const count = lastCompletedMB?.[kind];
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`missing positive nominal staircase MB for ${kind}`);
    return [kind, Number((processLineBytes / (count * MB)).toFixed(3))];
  }));
  return { source, processLineBytes, lastCompletedMB, effectiveFactors };
}

/** @param {string[]} argv */
function main(argv) {
  const args = Object.fromEntries(argv.map((a) => /^--([^=]+)=(.*)$/u.exec(a)).filter((m) => m !== null).map((m) => [m[1], m[2]]));
  const current = loadPhoneModel();
  const { devices } = current;
  if (args.device !== undefined) {
    const entry = Object.hasOwn(devices ?? {}, args.device) ? devices[args.device] : undefined;
    if (entry === undefined) throw new Error(`No report-only phone fit entry for ${args.device}`);
    console.log(JSON.stringify(entry, null, 1));
    return 0;
  }
  const read = (/** @type {string} */ f) => JSON.parse(readFileSync(f, 'utf8'));
  const out = args.out ?? new URL('phone-model.json', import.meta.url).pathname;
  const previous = (() => { try { return read(out); } catch { return current; } })();
  if (args.anchor === undefined && args.staircase !== undefined) {
    const staircase = fitStaircase(read(args.staircase), previous);
    writeFileSync(out, `${JSON.stringify({ ...previous, staircase }, null, 1)}\n`);
    console.log(JSON.stringify(staircase, null, 1));
    return 0;
  }
  const chromium = /** @type {Record<string, number[]>} */ ({});
  for (const f of (args.chromium ?? '').split(',').filter(Boolean)) { const run = read(f); const r = run.verdict?.rendererPeak?.bytes; if (typeof r === 'number') (chromium[run.chunk] ??= []).push(r); }
  const calibration = read(new URL('calibration.json', import.meta.url).pathname).hosts.webkit;
  const fitted = fitPhoneModel({ anchor: read(args.anchor).webkit, last: args.last ?? 'compile:after', zones: args.zones.split(',').map((f) => read(f).webkit), chromium,
    limitMB: Number(args.limit ?? current.limitMB), limitHighMB: Number(args['limit-high'] ?? args.limit ?? current.limitHighMB), gpuFloorMB: calibration.baselineMB.gpu });
  const sameLine = fitted.limitMB === current.limitMB && fitted.limitHighMB === current.limitHighMB;
  const evidence = args.staircase === undefined
    ? (sameLine ? previous.staircase ?? current.staircase : undefined)
    : read(args.staircase);
  const staircase = evidence === undefined ? undefined : fitStaircase(evidence, fitted);
  writeFileSync(out, `${JSON.stringify({ version: 1, note: previous.note ?? '', measured: args.measured ?? new Date().toISOString().slice(0, 10), host: previous.host ?? '',
    ...fitted, devices: { ...devices, ...previous.devices }, staircase }, null, 1)}\n`);
  console.log(JSON.stringify(fitted, null, 1));
  return 0;
}

if (process.argv[1] && import.meta.filename === (await import('node:path')).resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2));
