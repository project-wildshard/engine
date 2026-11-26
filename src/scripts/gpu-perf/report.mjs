// Pure nightly verdicts. Memory is decimal GB.
export const PHASE_LIMITS = { loading: 1.8, play: 1, explorer: 1 };
export const MEMORY_PROTOCOL = 'cold-origin-build-verified-v1';

// A failed collection must never silently replace the last complete, green reference.
export function memoryReferenceProblem(report, shards) {
  if (report.steps?.find((step) => step.name === 'memory')?.code !== 0) return 'memory collection did not exit successfully';
  if (report.steps.some((step) => step.code !== 0)) return 'run contains an unsuccessful step';
  if (report.memoryProtocol !== MEMORY_PROTOCOL) return 'cold origin/build identity was not verified';
  if (!Array.isArray(report.shards) || report.shards.length !== shards.length || shards.some((shard) => !report.shards.includes(shard))) return 'shard coverage differs or is unrecorded';
  if (!Array.isArray(report.memory) || report.memory.length !== shards.length * Object.keys(PHASE_LIMITS).length) return 'incomplete phase coverage';
  for (const shard of shards) for (const phase of Object.keys(PHASE_LIMITS)) {
    const matches = report.memory.filter((row) => row.shard === shard && row.phase === phase);
    if (matches.length !== 1) return 'missing or duplicate phase';
    const row = matches[0];
    if (row.verdict !== 'success') return 'memory gate is not green';
    if (row.measurement !== 'settled-median-3' || !row.settling) return 'measurement is not a settled median';
    if (memoryVerdict(shard, phase, row.nativeGB, row.inspectorGB).verdict !== 'success' || !Number.isFinite(row.nativePeakGB) || row.nativePeakGB <= 0 || row.nativePeakGB > PHASE_LIMITS[phase]) return 'invalid measurement or absolute limit';
  }
  return null;
}

export function selectMemoryReference(candidates, shards, started) {
  const rejected = [];
  for (const candidate of candidates.toSorted((a, b) => String(b.report.started).localeCompare(String(a.report.started)))) {
    if (!candidate.report.started || candidate.report.started >= started) continue;
    const reason = memoryReferenceProblem(candidate.report, shards);
    if (reason) rejected.push({ path: candidate.path, sha: candidate.report.sha ?? null, reason });
    else return { path: candidate.path, sha: candidate.report.sha ?? null, rejected };
  }
  return { path: '', sha: null, rejected };
}

/** The phase's reading: the median of three one-second samples taken after its work, with their spread beside it.
 * E388 deleted the invented "settled" rule on top (consecutive samples within 2 %, else a 20 s deadline): growth is
 * reported, never gated, and the only red is the native peak against the device limit. Of the 81 phase readings the
 * nightly recorded under that rule (four nights, 2026-10-02..03, ~/.wildshard/gpu-perf/*-sim-*), 75 met it on their
 * first three samples, and a median of three already drops a single phase-entry spike.
 * @param {{seconds: number, nativeGB: number, inspectorGB: number}[]} samples
 */
export function settledMemory(samples) {
  if (samples.length < 3) return null;
  const tail = samples.slice(-3);
  if (tail.some((sample) => !Number.isFinite(sample.nativeGB) || sample.nativeGB <= 0 || !Number.isFinite(sample.inspectorGB) || sample.inspectorGB <= 0)) return null;
  const seconds = tail[2].seconds;
  const median = (key) => tail.map((sample) => sample[key]).toSorted((a, b) => a - b)[1];
  const nativeGB = median('nativeGB'), inspectorGB = median('inspectorGB');
  const minGB = Math.min(...tail.map((sample) => sample.nativeGB));
  const maxGB = Math.max(...tail.map((sample) => sample.nativeGB));
  return { nativeGB, inspectorGB, minGB, maxGB, spreadGB: maxGB - minGB, spreadPercent: (maxGB - minGB) / nativeGB * 100,
    samples: tail, seconds };
}

export function memoryVerdict(shard, phase, nativeGB, inspectorGB, previousGB, pending = []) {
  const limitGB = PHASE_LIMITS[phase];
  if (!Number.isFinite(nativeGB) || nativeGB <= 0 || !Number.isFinite(inspectorGB) || inspectorGB <= 0 || limitGB === undefined)
    return { verdict: 'failure', reason: 'missing measurement', limitGB };
  if (nativeGB > limitGB) return { verdict: 'failure', reason: 'absolute limit', limitGB };
  // E388 (Jake 2026-10-02, "we're fighting against magic numbers"): the only red is the device limit (1.8 GB loading /
  // 1.0 GB play and Explorer, from the iPhone incident). Night-to-night growth is reported, never a gate: the old
  // "growth > 10%" band was invented. `shard` and `pending` stay in the signature for the callers.
  void shard; void pending;
  const growth = previousGB > 0 ? nativeGB / previousGB - 1 : null;
  return { verdict: 'success', reason: previousGB > 0 ? 'within the device limit' : 'first reading', limitGB, growth };
}

export function parseMemoryRun(nativeText, inspectorText, shard, previous = {}, pending = []) {
  const rows = (text) => text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const native = rows(nativeText).find((row) => row.type === 'summary');
  const inspectorRows = rows(inspectorText);
  const inspector = inspectorRows.find((row) => row.kind === 'summary')?.result;
  return Object.keys(PHASE_LIMITS).map((phase) => {
    const reading = inspectorRows.find((row) => row.kind === 'settled' && row.phase === phase)?.result;
    const nativePeakGB = native?.phases?.[phase]?.gameHighGB;
    const nativeGB = reading?.nativeGB ?? nativePeakGB;
    const inspectorGB = reading?.inspectorGB ?? inspector?.inspectorPeakGB?.[phase];
    const result = memoryVerdict(shard, phase, nativeGB, inspectorGB, previous[phase], pending);
    if (!Number.isFinite(nativePeakGB) || nativePeakGB <= 0) { result.verdict = 'failure'; result.reason = 'missing measurement'; }
    // Settling changes the growth measurement, never permission for a transient over the absolute cap.
    if (nativePeakGB > PHASE_LIMITS[phase]) { result.verdict = 'failure'; result.reason = 'absolute limit'; }
    if (inspector?.error || !native || (native.lost ?? []).some((lost) => lost.phase === phase)) {
      result.verdict = 'failure'; result.reason = inspector?.error ?? 'WebContent lost or incomplete';
    }
    const row = { shard, phase, nativeGB, inspectorGB, nativePeakGB, previousGB: previous[phase] ?? null,
      ...(reading ? { measurement: 'settled-median-3', settling: reading } : { measurement: 'legacy-peak' }) };
    return Object.assign(row, result);
  });
}

export function flakedFields(report) {
  const fields = report.flaked ? new Set(report.flaked) : new Set();
  for (const row of report.fields ?? []) if (row.verdict === 'flaked') fields.add(row.field);
  return [...fields].map((field) => `${report.boot?.shard}/${report.boot?.tier}/${field}`);
}

/** Frame-interval projection is informational: paced captures do not prove unpaced GPU time.
 * @param {{boot?:{shard?:string,tier?:string},poses?:Record<string,{frameP95Ms?:number}>}} report
 * @param {{k3060:number,source:string,assumption:string}} reference */
export function desktopProjections(report, reference) {
  if (report.boot?.tier !== 'desktop') return [];
  if (!Number.isFinite(reference.k3060) || reference.k3060 <= 0) throw new Error('Invalid desktop projection ratio');
  return Object.entries(report.poses ?? {}).map(([pose, row]) => {
    const measured = row.frameP95Ms;
    const projected3060FrameMs = typeof measured === 'number' && Number.isFinite(measured) && measured > 0 ? measured / reference.k3060 : null;
    return { shard: report.boot?.shard ?? '', pose, m5FrameMs: measured ?? null, projected3060FrameMs, targetFrameMs: 1000 / 60,
      verdict: projected3060FrameMs === null ? 'missing' : projected3060FrameMs <= 1000 / 60 ? 'within projection' : 'over projection',
      source: reference.source, assumption: reference.assumption, formula: 'M5 drawn-frame p95 interval / k3060; informational (includes capture pacing)' };
  });
}
