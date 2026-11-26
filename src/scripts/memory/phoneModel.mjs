// phoneModel.mjs, the iPhone's WebContent footprint from what the Mac can read (ENGINE-MEMORY EM11; meta
// docs/plans/ENGINE-MEMORY-PLAN.md, "The chain"). Replaces "phone = Chromium renderer x 2.0" (engine 3cd2dd87), a
// constant fitted to one crash, with a chain whose parameters `phone-model.json` holds and `phone-fit.mjs` refits:
//
//   phone [K] = WebKit WebContent [K] + alpha x (WebKit GPU process [K] - its blank floor)          (family A)
//
// On iOS WebKit hands the IOSurfaces and Metal resources it makes for a page to the page's WebContent process, so
// jetsam charges them to the page; on the Mac they stay in the GPU process. alpha is the share of the Mac GPU process
// the phone charges, and the one phone anchor bounds it from both sides: staging v0.1.36 with Nine rev 2 died on Jake's
// iPhone 17 Pro right after the boot trace's last `compile:after` (so the phone was over the line in that window) and
// lived through every window before it (under the line there). The same two inequalities on family B,
// phone = s x (WebContent + GPU over floor), bound a single scale on both processes, for the case where the phone's
// extra is not the GPU side (the Mac's JavaScriptCore keeps more garbage than the phone's: the Simulator's WebContent
// read ~1.0 GB where the Mac's read 1.75 GB on the same boot). The error bar is the envelope of both families over
// their feasible ranges; the central figure is family A at the middle of its range.
//
// Three readers take the chain from what they have:
//   - phoneFromWebKit: measured WebKit [K] (src/scripts/memory/measure.mjs, native WebKit on the Mac);
//   - phoneFromLedger: the ledger [L] (shard CI, the Developer chip, MG6): the fit of WebKit [K] on the ledger.
//     The chip and the boot probe use observed loading samples directly. A forecast from a settled sample applies the
//     measured peak-over-settled multiplier.
//   - phoneFromChromium: the historical ratio for replaying a Chromium renderer [R] peak under the loading card.
// Each returns {low, central, high} in bytes. The limit is CRASH_LINE (src/client/game/grid/budgetOverlay.ts): ActiveHard
// 2048 MiB, 2,147 MB decimal. `limitMB` and `limitHighMB` both carry it; the fit keeps two so a disputed line can be bracketed.
import { readFileSync } from 'node:fs';
import { phoneFromWebKit } from '../../shared/engine/core/phoneMemoryModel.ts';

export { phoneFromWebKit, ledgerSplit, phoneFromLedger } from '../../shared/engine/core/phoneMemoryModel.ts';

const MB = 1e6;
export const IPHONE_13_MODEL = 'iPhone14,5';

/** @typedef {{low:number, central:number, high:number}} Range */
/** @typedef {{step:string, peak:{webcontent:number, gpu:number}}} TraceWindow */

/** The committed model. @returns {any} */
export function loadPhoneModel() { return JSON.parse(readFileSync(new URL('phone-model.json', import.meta.url), 'utf8')); }

/**
 * Bound alpha (family A) and s (family B) from one boot the phone did not survive: its WebKit trace windows (one per boot
 * trace checkpoint, each the peak WebContent and GPU-process [K] from that checkpoint to the next) and the operation the
 * phone's report named last. The phone was over the line in the last window with that operation and under it in every
 * window before. The low ends use the lower limit, the high ends the higher one, so the range holds for either line.
 * @param {readonly TraceWindow[]} windows @param {string} lastOperation
 * @param {{limitMB:number, limitHighMB:number, gpuFloorMB:number}} options */
export function anchorBounds(windows, lastOperation, { limitMB, limitHighMB, gpuFloorMB }) {
  const at = windows.map((w) => w.step).lastIndexOf(lastOperation);
  if (at < 1) throw new Error(`the trace has no window "${lastOperation}" with windows before it`);
  const mb = (/** @type {number} */ b) => b / MB;
  const gpu = (/** @type {TraceWindow} */ w) => Math.max(0, mb(w.peak.gpu) - gpuFloorMB);
  const died = windows[at], before = windows.slice(0, at);
  const alphaLow = (limitMB - mb(died.peak.webcontent)) / gpu(died);
  const room = (/** @type {TraceWindow} */ w) => (gpu(w) > 0 ? (limitHighMB - mb(w.peak.webcontent)) / gpu(w) : Infinity);
  const binding = before.reduce((best, w) => (room(w) < room(best) ? w : best));
  const alphaHigh = room(binding);
  const scaleLow = limitMB / (mb(died.peak.webcontent) + gpu(died));
  const scaleHigh = Math.min(...before.map((w) => limitHighMB / (mb(w.peak.webcontent) + gpu(w))));
  return { alpha: { low: Math.max(0, alphaLow), high: Math.min(1, alphaHigh) }, scale: { low: scaleLow, high: scaleHigh },
    died: { step: died.step, webcontentMB: mb(died.peak.webcontent), gpuMB: mb(died.peak.gpu) },
    lived: { step: binding.step, webcontentMB: mb(binding.peak.webcontent), gpuMB: mb(binding.peak.gpu) }, consistent: alphaLow <= alphaHigh && scaleLow <= scaleHigh };
}

/** The phone's loading peak from a WebKit boot's checkpoints: each checkpoint through the chain, the largest of each end.
 * Peaks of the two processes inside one checkpoint need not coincide, so this leans high. @param {readonly {peak:{webcontent:number, gpu:number}}[]} checkpoints @param {any} model @returns {Range} */
export function phonePeakFromWebKit(checkpoints, model) {
  const rows = checkpoints.map((c) => phoneFromWebKit(c.peak, model));
  return { low: Math.max(...rows.map((r) => r.low)), central: Math.max(...rows.map((r) => r.central)), high: Math.max(...rows.map((r) => r.high)) };
}

/** The phone's loading peak from Chromium's renderer peak under the loading card [R]. @param {number} rendererBytes @param {any} model @returns {Range} */
export function phoneFromChromium(rendererBytes, model) {
  const r = model.chromium.loadingPerRenderer;
  return { low: rendererBytes * r.low, central: rendererBytes * r.central, high: rendererBytes * r.high };
}

/** One-sided 90% Student-t quantiles for 1 to 30 degrees of freedom. */
const T90 = Object.freeze([3.078, 1.886, 1.638, 1.533, 1.476, 1.440, 1.415, 1.397, 1.383, 1.372, 1.363, 1.356, 1.350, 1.345, 1.341,
  1.337, 1.333, 1.330, 1.328, 1.325, 1.323, 1.321, 1.319, 1.318, 1.316, 1.315, 1.314, 1.313, 1.311, 1.310]);

/** The one-sided 90% Student-t quantile; past 30 degrees of freedom, Cornish-Fisher from z = 1.2816. @param {number} df */
export function t90(df) {
  if (!(df >= 1)) throw new Error(`t90 needs at least one degree of freedom, got ${df}`);
  if (df <= T90.length) return T90[Math.floor(df) - 1];
  const z = 1.2816;
  return z + (z ** 3 + z) / (4 * df);
}

/**
 * EM11c (mini-em11c, 2026-11-18): a zone's upper bound over N cold runs, the one-sided 90% prediction bound on one more
 * cold boot's EM11 high: mean + t90(N-1) x sd x sqrt(1 + 1/N) of the runs' highs. Each run's high is already the model's
 * upper end (both families at the ends the v0.1.36 anchor allows), so the bound is the model's error bar on a boot the
 * phone might see, not on the runs we happened to take. It replaced "the highest run's high" (mini-sweep, epoch 6):
 * that maximum is a distribution-free prediction bound whose coverage rises with N (75% at 3 runs, 86% at 6), so it
 * widened as runs were added. This one holds coverage at 90%: its t and sqrt(1 + 1/N) shrink with N, so more runs
 * narrow it towards mean + 1.28 sd. One run has no spread to read; its high stands alone. Bytes in, bytes out.
 * @param {readonly number[]} highs
 */
export function upperOverRuns(highs) {
  const n = highs.length;
  if (n === 0) throw new Error('upperOverRuns needs at least one run');
  if (n === 1) return highs[0];
  const mean = highs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(highs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return mean + t90(n - 1) * sd * Math.sqrt(1 + 1 / n);
}

/** One zone over N cold WebKit runs (measure.mjs rows): per phase the median run's central figure and the 90% upper
 *  bound on one more boot (`upperOverRuns`). @param {readonly {settled:{webcontent:number, gpu:number}, checkpoints:readonly {peak:{webcontent:number, gpu:number}}[]}[]} runs @param {any} model */
export function zoneOverRuns(runs, model) {
  if (runs.length === 0) throw new Error('zoneOverRuns needs at least one run');
  const median = (/** @type {number[]} */ xs) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const playing = runs.map((r) => phoneFromWebKit(r.settled, model)), loading = runs.map((r) => phonePeakFromWebKit(r.checkpoints, model));
  return { runs: runs.length,
    playing: { central: median(playing.map((r) => r.central)), upper: upperOverRuns(playing.map((r) => r.high)) },
    loading: { central: median(loading.map((r) => r.central)), upper: upperOverRuns(loading.map((r) => r.high)) } };
}

/** "1.84 GB (1.52-2.31)" @param {Range} range */
export function rangeText(range) {
  const gb = (/** @type {number} */ b) => (b / 1e9).toFixed(2);
  return `${gb(range.central)} GB (${gb(range.low)}-${gb(range.high)})`;
}
