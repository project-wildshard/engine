// NINE-DRAGON-BENCHMAX NB6: a load stage's stalls. A stall is a stretch of a stage in which the page's main thread sat
// idle with no named wait open: no read, decode or worker job the boot timeline (Copy diagnostics' `__bootTiming`) says
// it waits on. A slower CPU makes a stage longer, not idler: on a loaded Mac at CPU x8, Nine's props never sat more than
// ~0.55 s of any 1 s idle this way (yields' timer clamps), while a 2 s sleep, or a wait on something unnamed, is idle for
// its whole length whatever the CPU. Ring 1's boot smoke refuses a stage that does (scripts/parity/boot-smoke.mjs), from a
// CPU profile of the boot (`profileIdle`) that maps samples onto the page clock.

/** The window a stall is judged over (ms), and the share of it that unexplained idle must reach to be one. */
export const STALL_WINDOW_MS = 1500, STALL_IDLE_SHARE = 0.8;
/** The load stages the ratchet holds: NB2's props, where Nine spent 10.6 s of Jake's Low Power load. */
export const STALL_STAGES = Object.freeze(['props']);

/** @typedef {{ operation: string, realm: string, start: number, end: number | null }} StallEntry */
/** @typedef {{ at: number, ms: number }} IdleSample one idle profile sample on the page clock: its time and its length */

/** Each listed stage's worst window: the most idle main-thread time with no page `wait:` entry open, in any
 * STALL_WINDOW_MS stretch of the stage.
 * @param {readonly StallEntry[]} entries @param {readonly IdleSample[]} idle @param {readonly string[]} [stages]
 * @returns {{ stage: string, from: number, idleMs: number, stageMs: number }[]} */
export function stageStalls(entries, idle, stages = STALL_STAGES) {
  const page = entries.filter(row => row.realm === 'page');
  const waits = page.filter(row => row.operation.startsWith('wait:')).map(row => [row.start, row.end ?? Number.POSITIVE_INFINITY]);
  const unexplained = idle.filter(sample => !waits.some(([from, to]) => from <= sample.at && sample.at <= to)).sort((a, b) => a.at - b.at);
  return stages.flatMap(stage => {
    const own = page.find(row => row.operation === `stage:${stage}` && row.end !== null);
    if (own === undefined || own.end === null) return [];
    const from = own.start, to = own.end, inside = unexplained.filter(sample => sample.at >= from && sample.at <= to);
    let worst = { stage, from: 0, idleMs: 0, stageMs: to - from }, low = 0, sum = 0;
    for (const sample of inside) {
      sum += sample.ms;
      while ((inside[low]?.at ?? sample.at) < sample.at - STALL_WINDOW_MS) { sum -= inside[low]?.ms ?? 0; low++; }
      if (sum > worst.idleMs) worst = { stage, from: (inside[low]?.at ?? from) - from, idleMs: sum, stageMs: to - from };
    }
    return [worst];
  });
}

/** Stage stalls as fault lines: a window whose unexplained idle reaches STALL_IDLE_SHARE of it.
 * @param {readonly StallEntry[]} entries @param {readonly IdleSample[]} idle @returns {string[]} */
export function stallFaults(entries, idle) {
  return stageStalls(entries, idle).filter(row => row.idleMs >= STALL_WINDOW_MS * STALL_IDLE_SHARE)
    .map(row => `Load stall: ${row.stage} sat ${(row.idleMs / 1000).toFixed(2)} s of ${(STALL_WINDOW_MS / 1000).toFixed(1)} s idle with no named wait (from +${(row.from / 1000).toFixed(1)} s of its ${(row.stageMs / 1000).toFixed(1)} s; NINE-DRAGON-BENCHMAX NB6)`);
}

/** A Chromium CPU profile's idle samples on the page clock. `pageEnd` is the page's `performance.now()` read just before
 * `Profiler.stop` (the profile's own end), so a sample's page time is `pageEnd` less its distance from that end.
 * @param {{ nodes: readonly { id: number, callFrame: { functionName: string } }[], samples?: readonly number[], timeDeltas?: readonly number[], startTime: number, endTime: number }} profile
 * @param {number} pageEnd @returns {IdleSample[]} */
export function profileIdle(profile, pageEnd) {
  const idleNodes = new Set(profile.nodes.filter(node => node.callFrame.functionName === '(idle)').map(node => node.id));
  /** @type {IdleSample[]} */ const out = [];
  const samples = profile.samples ?? [];
  let at = profile.startTime;
  const times = (profile.timeDeltas ?? []).map(delta => (at += delta));
  for (let i = 0; i + 1 < samples.length; i++) {
    if (!idleNodes.has(samples[i] ?? -1)) continue;
    const time = times[i] ?? 0, next = times[i + 1] ?? time;
    out.push({ at: pageEnd - (profile.endTime - time) / 1000, ms: (next - time) / 1000 });
  }
  return out;
}

/** Browser-side: the page's boot timeline entries (its own collector, as Copy diagnostics reads it). */
export function bootTimelineEntries() {
  const timing = Reflect.get(globalThis, '__bootTiming'), read = timing === undefined ? undefined : Reflect.get(timing, 'read');
  const data = typeof read === 'function' ? read.call(timing) : timing;
  const entries = data === undefined || data === null ? [] : Reflect.get(data, 'entries');
  return Array.isArray(entries) ? entries.map(row => ({ operation: String(row.operation), realm: String(row.realm), start: Number(row.start), end: row.end === null ? null : Number(row.end) })) : [];
}

/** Start a stall profile of `page` (Chromium only: null elsewhere), 5 ms samples, before the entry tap.
 * @param {import('playwright').Page} page @returns {Promise<import('playwright').CDPSession | null>} */
export async function startStallProfile(page) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return null;
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable'); await session.send('Profiler.setSamplingInterval', { interval: 5000 }); await session.send('Profiler.start');
  return session;
}

/** End a stall profile at control: the ratcheted stages' worst windows and their faults.
 * @param {import('playwright').Page} page @param {import('playwright').CDPSession} session */
export async function finishStallProfile(page, session) {
  const pageEnd = await page.evaluate(() => performance.now());
  const { profile } = await session.send('Profiler.stop');
  await session.detach().catch(() => undefined);
  const entries = await page.evaluate(bootTimelineEntries), idle = profileIdle(profile, pageEnd);
  return { stalls: stageStalls(entries, idle), faults: stallFaults(entries, idle) };
}
