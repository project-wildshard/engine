// NINE-DRAGON-BENCHMAX NB6: a load stage's stalls. A stall is a stretch of a stage in which the page's main thread sat
// idle with no named wait open: no read, decode or worker job the boot timeline (Copy diagnostics' `__bootTiming`) says
// it waits on. A slower CPU makes a stage longer, not idler: on a loaded Mac at CPU x8, Nine's props never sat more than
// ~0.65 s of any 1.5 s idle this way (yields' timer clamps), while a 2 s sleep, or a wait on something unnamed, is idle
// for its whole length whatever the CPU. Ring 1's boot smoke refuses a stage that does (scripts/parity/boot-smoke.mjs),
// from a CPU profile of the boot whose clock is pinned to the page's by a named busy mark (CLOCK_MARK).
// A stall beside a named wait that happens to overlap it (audio, artwork) is masked: the ratchet catches unnamed idle, not
// every delay on the critical path.

/** The window a stall is judged over (ms), and the share of it that unexplained idle must reach to be one. */
export const STALL_WINDOW_MS = 1500, STALL_IDLE_SHARE = 0.8;
/** The load stages the ratchet holds: NB2's props, where Nine spent 10.6 s of Jake's Low Power load. */
export const STALL_STAGES = Object.freeze(['props']);
/** The page function the clock mark runs, by this name in the profile. */
export const CLOCK_MARK = '__wildshardStallClock';

/** @typedef {{ operation: string, realm: string, start: number, end: number | null }} StallEntry */
/** @typedef {{ start: number, end: number }} Span an idle stretch on the page clock (ms) */

/** @param {readonly Span[]} list @returns {Span[]} sorted and merged */
function merged(list) {
  /** @type {Span[]} */ const out = [];
  for (const span of [...list].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end); else out.push({ ...span });
  }
  return out;
}

/** `spans` merged, minus `holes`, cut to [from, to]: sorted, disjoint, non-empty.
 * @param {readonly Span[]} spans @param {readonly Span[]} holes @param {number} from @param {number} to @returns {Span[]} */
export function idleWithin(spans, holes, from, to) {
  const gaps = merged(holes);
  return merged(spans).flatMap(span => {
    /** @type {Span[]} */ let pieces = [{ start: Math.max(span.start, from), end: Math.min(span.end, to) }];
    for (const gap of gaps) pieces = pieces.flatMap(piece => gap.end <= piece.start || gap.start >= piece.end ? [piece]
      : [{ start: piece.start, end: gap.start }, { start: gap.end, end: piece.end }]);
    return pieces.filter(piece => piece.end > piece.start);
  });
}

/** The most of `spans` (sorted, disjoint) inside any `width` window, and where that window starts: it starts at a span's
 * start or ends at a span's end, and every span is cut at the window's edges.
 * @param {readonly Span[]} spans @param {number} width @returns {{ at: number, ms: number }} */
export function busiestWindow(spans, width) {
  /** @param {number} start */
  const covered = start => {
    const end = start + width;
    let ms = 0;
    for (const span of spans) { if (span.end <= start) continue; if (span.start >= end) break; ms += Math.min(span.end, end) - Math.max(span.start, start); }
    return ms;
  };
  let best = { at: 0, ms: 0 };
  for (const start of spans.flatMap(span => [span.start, span.end - width])) {
    const ms = covered(start);
    if (ms > best.ms) best = { at: start, ms };
  }
  return best;
}

/** Each listed stage's worst window: the most idle main-thread time with no page `wait:` entry open, in any
 * STALL_WINDOW_MS stretch, every idle stretch cut to the stage, the waits and the window.
 * @param {readonly StallEntry[]} entries @param {readonly Span[]} idle @param {readonly string[]} [stages]
 * @returns {{ stage: string, from: number, idleMs: number, stageMs: number }[]} */
export function stageStalls(entries, idle, stages = STALL_STAGES) {
  const page = entries.filter(row => row.realm === 'page');
  const waits = page.filter(row => row.operation.startsWith('wait:')).map(row => ({ start: row.start, end: row.end ?? Number.POSITIVE_INFINITY }));
  return stages.flatMap(stage => {
    const own = page.find(row => row.operation === `stage:${stage}` && row.end !== null);
    if (own === undefined || own.end === null) return [];
    const worst = busiestWindow(idleWithin(idle, waits, own.start, own.end), STALL_WINDOW_MS);
    return [{ stage, from: Math.max(0, worst.at - own.start), idleMs: worst.ms, stageMs: own.end - own.start }];
  });
}

/** Stage stalls as fault lines: a window whose unexplained idle reaches STALL_IDLE_SHARE of it.
 * @param {readonly StallEntry[]} entries @param {readonly Span[]} idle @returns {string[]} */
export function stallFaults(entries, idle) {
  return stageStalls(entries, idle).filter(row => row.idleMs >= STALL_WINDOW_MS * STALL_IDLE_SHARE)
    .map(row => `Load stall: ${row.stage} sat ${(row.idleMs / 1000).toFixed(2)} s of ${(STALL_WINDOW_MS / 1000).toFixed(1)} s idle with no named wait (from +${(row.from / 1000).toFixed(1)} s of its ${(row.stageMs / 1000).toFixed(1)} s; NINE-DRAGON-BENCHMAX NB6)`);
}

/** @typedef {{ nodes: readonly { id: number, callFrame: { functionName: string } }[], samples?: readonly number[], timeDeltas?: readonly number[], startTime: number, endTime: number }} CpuProfile */

/** Where the profile's clock meets the page's: the first sample of the clock mark (CLOCK_MARK) against the page time the
 * mark started at. That sample lands within one sampling interval after the mark's start, which bounds the error.
 * @param {CpuProfile} profile @param {number} markPageMs @returns {{ pageMs: number, profileUs: number }} */
export function profileAnchor(profile, markPageMs) {
  const marks = new Set(profile.nodes.filter(node => node.callFrame.functionName === CLOCK_MARK).map(node => node.id));
  const samples = profile.samples ?? [];
  let at = profile.startTime;
  for (const [i, delta] of (profile.timeDeltas ?? []).entries()) { at += delta; if (marks.has(samples[i] ?? -1)) return { pageMs: markPageMs, profileUs: at }; }
  throw new Error('Stall profile has no clock mark sample');
}

/** A Chromium CPU profile's idle stretches on the page clock: sample i is idle over [its time, the next sample's).
 * @param {CpuProfile} profile @param {{ pageMs: number, profileUs: number }} anchor @returns {Span[]} */
export function profileIdle(profile, anchor) {
  const idleNodes = new Set(profile.nodes.filter(node => node.callFrame.functionName === '(idle)').map(node => node.id));
  const samples = profile.samples ?? [], page = (/** @type {number} */ us) => anchor.pageMs + (us - anchor.profileUs) / 1000;
  let at = profile.startTime;
  const times = (profile.timeDeltas ?? []).map(delta => (at += delta));
  /** @type {Span[]} */ const out = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    if (!idleNodes.has(samples[i] ?? -1)) continue;
    out.push({ start: page(times[i] ?? 0), end: page(times[i + 1] ?? 0) });
  }
  return out;
}

let clockMarks = 0;
/** The page expression that runs the clock mark: 30 ms busy inside CLOCK_MARK, returning its start on the page clock. Each
 * call's text is new: V8 reuses a repeated eval's compiled script, and a second mark (play's profile after boot's) then
 * ran with CLOCK_MARK inlined into its caller and never sampled by name (NB6).
 * @returns {string} */
export function clockMarkExpression() {
  return `/* clock mark ${++clockMarks} */ (() => { const start = performance.now(), until = start + 30;
  function ${CLOCK_MARK}() { while (performance.now() < until) { /* busy: the profiler samples this function */ } }
  ${CLOCK_MARK}(); return start; })()`;
}

/** Browser-side: the page's boot timeline entries (its own collector, as Copy diagnostics reads it). */
export function bootTimelineEntries() {
  const timing = Reflect.get(globalThis, '__bootTiming'), read = timing === undefined ? undefined : Reflect.get(timing, 'read');
  const data = typeof read === 'function' ? read.call(timing) : timing;
  const entries = data === undefined || data === null ? [] : Reflect.get(data, 'entries');
  return Array.isArray(entries) ? entries.map(row => ({ operation: String(row.operation), realm: String(row.realm), start: Number(row.start), end: row.end === null ? null : Number(row.end) })) : [];
}

/** Start a stall profile of `page` (Chromium only: null elsewhere), 5 ms samples, before the document loads.
 * @param {import('playwright').Page} page @returns {Promise<import('playwright').CDPSession | null>} */
export async function startStallProfile(page) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return null;
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable'); await session.send('Profiler.setSamplingInterval', { interval: 5000 }); await session.send('Profiler.start');
  return session;
}

/** End a stall profile at control: pin its clock with the mark, then the ratcheted stages' worst windows and their faults.
 * @param {import('playwright').Page} page @param {import('playwright').CDPSession} session */
export async function finishStallProfile(page, session) {
  const markPageMs = Number(await page.evaluate(clockMarkExpression()));
  const { profile } = await session.send('Profiler.stop');
  await session.detach().catch(() => undefined);
  const entries = await page.evaluate(bootTimelineEntries), idle = profileIdle(profile, profileAnchor(profile, markPageMs));
  return { stalls: stageStalls(entries, idle), faults: stallFaults(entries, idle) };
}

// NINE-DRAGON-BENCHMAX NB6, widened to play (meta QA-FEEDBACK-2026-11-14 rows 2, 3, 5): a play stall is a stretch of live
// frames in which the page's main thread ran its own work without a break: script, layout, style or GC, but not idle and
// not a WebGL call waiting on the GPU process. A slow or software GPU (CI's SwiftShader draws a frame every few seconds)
// makes frames slower and the main thread idler or GPU-bound, not busier; a 2 s busy sleep in a frame is busy for its whole
// length whatever the GPU. Ring 1's boot smoke refuses one over the ten gameplay frames it already waits on, every case.
/** The share of a STALL_WINDOW_MS stretch of play that unbroken main-thread work must reach to be a stall. */
export const PLAY_BUSY_SHARE = 0.8;
/** Native leaves that are still the page's own work: the clock read a busy loop spins on, and the collector. Every other
 * native leaf (no script url) is left out: on CI's SwiftShader any WebGL entry point can wait seconds on the GPU process
 * (a link finishing under `getUniformLocation`, a fence under `getError`), and a named list missed some (ring 1, sunscar
 * dunes, 2026-11-14: a 1.5 s "stall" 15 s into play at 2.4 s a frame). A page stall is script; its builtins undercount it. */
const PAGE_NATIVE = new Set(['now', '(garbage collector)']);

/** A Chromium CPU profile's main-thread work on the page clock: every sample whose leaf is script (it has a url) or one of
 * PAGE_NATIVE, over [its time, the next sample's).
 * @param {CpuProfile & { nodes: readonly { id: number, callFrame: { functionName: string, url?: string } }[] }} profile
 * @param {{ pageMs: number, profileUs: number }} anchor @returns {Span[]} */
export function profileBusy(profile, anchor) {
  const quiet = new Set(profile.nodes.filter(node => (node.callFrame.url ?? '') === '' && !PAGE_NATIVE.has(node.callFrame.functionName)).map(node => node.id));
  const samples = profile.samples ?? [], page = (/** @type {number} */ us) => anchor.pageMs + (us - anchor.profileUs) / 1000;
  let at = profile.startTime;
  const times = (profile.timeDeltas ?? []).map(delta => (at += delta));
  /** @type {Span[]} */ const out = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    if (quiet.has(samples[i] ?? -1)) continue;
    out.push({ start: page(times[i] ?? 0), end: page(times[i + 1] ?? 0) });
  }
  return merged(out);
}

/** Play's worst window: the most main-thread work in any STALL_WINDOW_MS stretch of [from, to].
 * @param {readonly Span[]} busy @param {number} from @param {number} to @returns {{ from: number, busyMs: number, playMs: number }} */
export function playStall(busy, from, to) {
  const worst = busiestWindow(idleWithin(busy, [], from, to), STALL_WINDOW_MS);
  return { from: Math.max(0, worst.at - from), busyMs: worst.ms, playMs: to - from };
}

/** A play stall as a fault line, when its window's work reaches PLAY_BUSY_SHARE of it.
 * @param {{ from: number, busyMs: number, playMs: number }} stall @returns {string[]} */
export function playStallFaults(stall) {
  return stall.busyMs < STALL_WINDOW_MS * PLAY_BUSY_SHARE ? []
    : [`Play stall: the main thread worked ${(stall.busyMs / 1000).toFixed(2)} s of a ${(STALL_WINDOW_MS / 1000).toFixed(1)} s window without a break (from +${(stall.from / 1000).toFixed(1)} s of ${(stall.playMs / 1000).toFixed(1)} s of play; NINE-DRAGON-BENCHMAX NB6)`];
}

/** End a play profile (started with `startStallProfile` at the first gameplay frame): pin its clock with the mark, then
 * play's worst window and its fault.
 * @param {import('playwright').Page} page @param {import('playwright').CDPSession} session @param {number} fromPageMs */
export async function finishPlayProfile(page, session, fromPageMs) {
  const markPageMs = Number(await page.evaluate(clockMarkExpression()));
  const { profile } = await session.send('Profiler.stop');
  await session.detach().catch(() => undefined);
  // the clock mark's own 30 ms of busy work ends the window
  const stall = playStall(profileBusy(profile, profileAnchor(profile, markPageMs)), fromPageMs, markPageMs);
  return { stall, faults: playStallFaults(stall) };
}
