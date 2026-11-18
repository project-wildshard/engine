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
//   - phoneFromWebKit: measured WebKit [K] (scripts/memory/measure.mjs, native WebKit on the Mac);
//   - phoneFromLedger: only the ledger [L] (CI on ubuntu, the Developer chip, shard-format's estimate, MG6): the
//     zones' fit of WebKit [K] on the ledger, settled at control, and the measured peak over settled for loading;
//   - phoneFromChromium: the Chromium renderer [R] peak under the loading card (scripts/boot-memory-peak.mjs), times
//     the zones' fitted ratio of the phone's loading peak to that renderer peak.
// Each returns {low, central, high} in bytes. The limit is CRASH_LINE (src/client/game/grid/budgetOverlay.ts): ActiveHard
// 2048 MiB, 2,147 MB decimal. `limitMB` and `limitHighMB` both carry it; the fit keeps two so a disputed line can be bracketed.
import { readFileSync } from 'node:fs';
import { phoneFromWebKit } from '../../src/shared/engine/core/phoneMemoryModel.ts';

export { phoneFromWebKit, ledgerSplit, phoneFromLedger } from '../../src/shared/engine/core/phoneMemoryModel.ts';

const MB = 1e6;

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

/** "1.84 GB (1.52-2.31)" @param {Range} range */
export function rangeText(range) {
  const gb = (/** @type {number} */ b) => (b / 1e9).toFixed(2);
  return `${gb(range.central)} GB (${gb(range.low)}-${gb(range.high)})`;
}
