import { loadingShardName } from './catalogue.mjs';

/** A reader owns its own set-based shared-preview lease, not its launcher's.
 * Use the same derived environment for acquisition and release.
 * @param {Record<string, string | undefined>} environment @param {number} pid */
export function compiledPreviewEnvironment(environment, pid) {
  return {...environment, SERVE_OWNER: `${environment.SERVE_OWNER ?? 'sim-grid-entry'}:reader:${pid}`};
}

/** Keep post-controls polls independent of the frozen loading/resource bank.
 * Injected into Safari: dependencies must stay inside the function.
 * @template {{errors: readonly string[]}} T
 * @template U
 * @param {boolean} details @param {T | null} accuracy @param {() => U} measures
 * @returns {{accuracy: T | null; measures: U} | {errors: readonly string[]}} */
export function compiledPollDetails(details, accuracy, measures) {
  return details ? { accuracy, measures: measures() } : { errors: accuracy?.errors ?? [] };
}

/** Stop on the actual visible fault even when a warm worker served HTML
 * without the diagnostic recorder. A failed state read cannot hide the fault.
 * @param {{error?: string | null}} sample @param {() => Promise<unknown>} read */
export async function compiledVisibleFailure(sample, read) {
  const error = sample.error;
  if (typeof error !== 'string' || error.trim() === '') return null;
  try { return {error, state: await read()}; }
  catch (captureError) { return {error, state: null, captureError: String(captureError)}; }
}

/** Keep callback coverage separate from painted frames and label correctness.
 * Missing/overflowed/truncated records cannot qualify complete observation.
 * @param {import('./accuracy-data.d.mts').AdmissionFrames | undefined} record */
export function admissionFrameEvidence(record) {
  if (record === undefined) return {callbackRecordComplete: false, reason: 'missing', observedFrames: 0, blankFooterFrames: null};
  /** @param {unknown} value */
  const integer = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (record.protocol !== 'loading-admission-raf/1' || !integer(record.frames) || !integer(record.droppedFrames)
    || !integer(record.truncatedFrames) || !Number.isFinite(record.maxGapMs) || record.maxGapMs < 0 || record.runs.length > 256)
    throw new Error('Invalid admission frame record');
  let frames = 0, blankFooterFrames = 0, last = -1;
  for (const run of record.runs) {
    if (!integer(run.frames) || run.frames === 0 || !Number.isFinite(run.firstAt) || run.firstAt < 0
      || !Number.isFinite(run.lastAt) || run.lastAt < run.firstAt || run.firstAt < last
      || [run.step, run.footer, run.waiting, run.filesInFlight].some(value => typeof value !== 'string' || value.length > 1024))
      throw new Error('Invalid admission frame run');
    frames += run.frames; last = run.lastAt;
    if (run.footer.trim() === '') blankFooterFrames += run.frames;
  }
  if (frames + record.droppedFrames !== record.frames || record.truncatedFrames > record.frames
    || record.endedAt !== null && (!Number.isFinite(record.endedAt) || record.endedAt < last)) throw new Error('Incomplete admission frame accounting');
  const reason = record.frames === 0 ? 'no admission callbacks' : record.endedAt === null ? 'unfinished'
    : record.droppedFrames > 0 ? 'overflow' : record.truncatedFrames > 0 ? 'truncated' : null;
  return {callbackRecordComplete: reason === null, reason, observedFrames: record.frames,
    blankFooterFrames: record.droppedFrames === 0 && record.truncatedFrames === 0 ? blankFooterFrames : null};
}

/** Sample the compiled card's actual controls, then eight seconds of rAF gaps.
 * Loading gaps before the first ready frame are excluded; a frame straddling
 * the window end keeps its full duration rather than hiding a long freeze.
 * @param {import('./sim-shard.mjs').CompiledFrameWindow} state
 * @param {number} at @param {boolean} ready */
export function sampleCompiledFrame(state, at, ready) {
  if (!Number.isFinite(at) || at < 0 || state.last !== null && at < state.last) throw new Error('Invalid compiled frame clock');
  if (state.complete) return;
  if (state.controlsAt === null) {
    if (ready) { state.controlsAt = at; state.last = at; }
    return;
  }
  if (state.last === null) throw new Error('Missing compiled frame start');
  const gap = at - state.last;
  if (gap > 0) {
    state.frames++;
    if (gap > state.worst) { state.worst = gap; state.worstAt = at - state.controlsAt; }
  }
  state.last = at; state.complete = at - state.controlsAt >= 8000;
}

/** Keep the controls timestamp fixed while the post-controls sample drains.
 * @param {import('./sim-shard.mjs').CompiledFrameWindow | null | undefined} state
 * @param {number} origin @param {number} tap */
export function compiledFrameMetrics(state, origin, tap) {
  if (state === null || state === undefined || !state.complete || state.controlsAt === null || state.last === null || state.frames === 0 || !Number.isFinite(origin) || !Number.isFinite(tap)) throw new Error('Incomplete compiled frame window');
  return { controlsMs: Math.round(origin + state.controlsAt - tap), controlsObservationIntervalMs: 500,
    worstFrameAfterControlsMs: state.worst, worstFrameAfterControlsAtMs: state.worstAt,
    postControlsFrames: state.frames, postControlsWindowMs: 8000, postControlsObservedMs: state.last - state.controlsAt };
}

/** Qualify every completed compiled visit; a median must not hide one miss.
 * Exit 1 is incomplete/refused evidence; exit 2 is a measured frame miss.
 * @param {readonly {error?: string; worstFrameAfterControlsMs?: number}[]} rows
 * @returns {import('./sim-shard.mjs').CompiledEntryQualification} */
export function compiledEntryQualification(rows) {
  let worst = null;
  for (const row of rows) {
    const frame = row.worstFrameAfterControlsMs;
    if (row.error !== undefined || typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) {
      return { frameLimitMs: 100, complete: false, passed: false, worstFrameAfterControlsMs: null, exitCode: 1 };
    }
    worst = Math.max(worst ?? 0, frame);
  }
  if (worst === null) return { frameLimitMs: 100, complete: false, passed: false, worstFrameAfterControlsMs: null, exitCode: 1 };
  const passed = worst <= 100;
  return { frameLimitMs: 100, complete: true, passed, worstFrameAfterControlsMs: worst, exitCode: passed ? 0 : 2 };
}

/** Safari's timeOrigin can round differently in one live document. Fence
 * navigation with its per-document token. Retain the page origin and raw
 * drift so worker-relative receipts can be aligned from the result alone.
 * @param {import('./sim-shard.mjs').CompiledDocument} first
 * @param {import('./sim-shard.mjs').CompiledDocument} last */
export function compiledDocumentEvidence(first, last) {
  if (typeof first.documentToken !== 'string' || first.documentToken.length === 0
    || first.documentToken !== last.documentToken || !Number.isFinite(first.origin) || !Number.isFinite(last.origin))
    throw new Error('Compiled frame window changed document or has no document identity');
  return { token: first.documentToken, timeOrigin: first.origin, originDriftMs: last.origin - first.origin };
}

/** Read only this compiled phone path's persisted calibration. Serialized into
 * the existing Inspector evaluation; unrelated save fields never leave it.
 * @param {() => string | null} readDevice @param {string} identity
 * @returns {import('./sim-shard.mjs').CompiledTimingHistory} */
export function compiledTimingHistory(readDevice, identity) {
  const key = `path:v3:phone:shardfile:${identity}`;
  try {
    const raw = readDevice();
    if (raw === null) return {key, values: null};
    if (raw.length > 1024 * 1024) throw new Error('Device record exceeds evidence limit');
    const doc = JSON.parse(raw), slot = doc?.keys?.['boot.times'];
    if (slot === undefined) return {key, values: null};
    if (slot?.v !== 1 || slot.data === null || typeof slot.data !== 'object' || Array.isArray(slot.data)) throw new Error('Invalid timing record');
    const values = slot.data[key];
    if (values === undefined) return {key, values: null};
    if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid path history');
    const rows = Object.entries(values);
    if (rows.length > 64 || rows.some(([name, ms]) => name.length > 128 || typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0)) throw new Error('Invalid path timings');
    return {key, values: Object.fromEntries(rows)};
  } catch (error) {
    return {key, values: null, error: String(error).slice(0, 200)};
  }
}

/** A saved-pose update skips descent; require actual unpaused gameplay rather than an invented reveal. */
export function recoveredGridControls(sample) {
  return sample?.bootEntry?.reason === 'reload' && sample.bootEntry.saved === true
    && sample.bootEntry.continuing === true && sample.bootEntry.grid === true
    && sample.world?.entered === true && sample.world.paused === false && sample.world.frameGate === true
    && sample.loaderVisible === false && sample.title === false && sample.error === null
    && Number.isFinite(sample.origin) && Number.isFinite(sample.at);
}

/** Exact compiled route fence; the similarly named legacy route is not evidence. */
export function requireCompiledEntry(href, shard, accuracy) {
  loadingShardName(shard);
  if (new URL(href).searchParams.get('chunk') !== shard || accuracy?.final?.path !== 'shardfile') throw new Error('Expected exact compiled shard entry');
  if (!Number.isFinite(accuracy.readyAt) || !(accuracy.readyAt > 0) || accuracy.errors.length > 0) throw new Error('Compiled entry did not finish cleanly');
}

/** Report observed counters without smoothing missing samples or denominator growth. */
export function downloadEvidence(samples) {
  let previous, admission = false, changes = 0, drops = 0, maximumError = 0, measured = 0;
  for (const sample of samples) {
    // Painted rows use the bare key; live subphase updates use the prefix.
    // Module preparation precedes product admission and is not step two.
    if (sample.step === 'admission' || sample.step?.startsWith('admission.') && sample.step !== 'admission.modules') admission = true;
    const total = Number(sample.declaredBytes), pending = Number(sample.pendingBytes), shown = Number(sample.downloadPercent);
    if ([sample.declaredBytes, sample.pendingBytes, sample.downloadPercent].some(value => value === undefined || value.trim() === '')
      || ![total, pending, shown].every(Number.isFinite) || total <= 0 || pending < 0 || pending > total || shown < 0 || shown > 100) continue;
    if (previous !== undefined) {
      if (admission && total !== previous.total) changes++;
      if (shown < previous.shown) drops++;
    }
    maximumError = Math.max(maximumError, Math.abs(shown - 100 * (total - pending) / total));
    previous = { total, shown }; measured++;
  }
  return { measuredFrames: measured, missingFrames: samples.length - measured, denominatorChangesAfterAdmission: changes,
    downloadDrops: drops, maxPercentError: measured === 0 ? null : maximumError, finalDeclaredBytes: previous?.total ?? null };
}

/** Read the existing visible samples; this adds no page observer or timer.
 * Step starts are first OBSERVED samples, not interpolated stage boundaries.
 * Keep rounded displayed-clock ratios and, when the existing panel origin is
 * available, independent monotonic sample ratios. Neither invents a boundary.
 * @param {readonly import('./sim-shard.mjs').StepSample[]} samples */
export function stepEvidence(samples) {
  /** @param {string | undefined} text */
  const clockMs = text => typeof text === 'string' && /^\d+:\d{2}\.\d$/u.test(text)
    ? text.split(':').reduce((minutes, value) => minutes * 60 + Number(value), 0) * 1000 : null;
  const finalClock = clockMs(samples.at(-1)?.clock);
  const finalElapsed = samples.at(-1)?.elapsedMs;
  let previousNumber = 0, previousTotal = null, totalChanges = 0, numberRegressions = 0, numberedFrames = 0, lastSetupBeforeFade = null;
  const starts = [];
  for (const sample of samples) {
    const setup = typeof sample.setup === 'string' && /^(?:100|\d{1,2})$/u.test(sample.setup) ? Number(sample.setup) : null;
    if (sample.fading === false && setup !== null) lastSetupBeforeFade = setup;
    const step = /^step (\d+) \/ (\d+) ·/u.exec(sample.detail ?? '');
    if (step === null) continue;
    const number = Number(step[1]), total = Number(step[2]);
    if (!Number.isSafeInteger(number) || !Number.isSafeInteger(total) || number < 1 || number > total) continue;
    numberedFrames++;
    if (previousTotal !== null && total !== previousTotal) totalChanges++;
    if (number < previousNumber) numberRegressions++;
    if (number !== previousNumber) {
      const elapsed = clockMs(sample.clock);
      const elapsedPercent = elapsed !== null && finalClock !== null && finalClock > 0 ? 100 * elapsed / finalClock : null;
      const pageElapsedPercent = typeof sample.elapsedMs === 'number' && Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0
        && typeof finalElapsed === 'number' && Number.isFinite(finalElapsed) && finalElapsed > 0 && sample.elapsedMs <= finalElapsed
        ? 100 * sample.elapsedMs / finalElapsed : null;
      starts.push({ number, total, setup, elapsedPercent,
        errorPoints: setup !== null && elapsedPercent !== null ? Math.abs(setup - elapsedPercent) : null,
        ...(pageElapsedPercent === null ? {} : {pageElapsedPercent,
          pageErrorPoints: setup === null ? null : Math.abs(setup - pageElapsedPercent)}) });
    }
    previousNumber = number; previousTotal = total;
  }
  return { numberedFrames, totalSteps: previousTotal, totalChanges, numberRegressions, observedStarts: starts, lastSetupBeforeFade };
}

/** Grade retained DOM setup facts against their actual first-entry clocks.
 * Missing coverage never turns a partial good result into acceptance; a known
 * miss remains a miss even when another boundary is unknown. No paint claim.
 * @param {import('./sim-shard.mjs').StepBoundarySample | null | undefined} final */
export function stepBoundaryEvidence(final) {
  const empty = {complete: false, reason: 'missing completed clock', executedRows: 0, measuredStarts: 0,
    missingStarts: [], maxErrorPoints: null, within15Points: null, starts: []};
  if (final?.fading !== true || typeof final.at !== 'number' || !Number.isFinite(final.at)
    || typeof final.elapsedMs !== 'number' || !Number.isFinite(final.elapsedMs) || final.elapsedMs <= 0
    || final.at < final.elapsedMs) return empty;
  const rows = final.rows;
  if (rows === undefined || rows.length === 0) return {...empty, reason: 'missing rows'};
  if (rows.length > 256) throw new Error('Invalid step boundary rows');
  const origin = final.at - final.elapsedMs, keys = new Set(), missingStarts = [], starts = [];
  let maximum = null;
  for (const row of rows) {
    if (row.key === undefined || row.key === '' || row.key === 'gap') continue;
    if (keys.has(row.key)) throw new Error('Duplicate step boundary');
    keys.add(row.key);
    if (row.startedAt === undefined || row.startedAt === '' || row.setupAtStart === undefined || row.setupAtStart === '') {
      missingStarts.push(row.key); continue;
    }
    const startedAt = Number(row.startedAt), setup = Number(row.setupAtStart);
    if (!Number.isFinite(startedAt) || startedAt < origin || startedAt > final.at
      || !/^(?:100|\d{1,2})$/u.test(row.setupAtStart)) throw new Error('Invalid step boundary facts');
    const elapsedPercent = 100 * (startedAt - origin) / final.elapsedMs;
    const errorPoints = Math.abs(setup - elapsedPercent);
    maximum = Math.max(maximum ?? 0, errorPoints);
    starts.push({key: row.key, startedAt, setup, elapsedPercent, errorPoints});
  }
  const complete = keys.size > 0 && missingStarts.length === 0;
  return {complete, reason: keys.size === 0 ? 'missing rows' : complete ? null : 'missing step facts',
    executedRows: keys.size, measuredStarts: starts.length, missingStarts, starts, maxErrorPoints: maximum,
    within15Points: maximum !== null && maximum > 15 ? false : complete ? true : null};
}

/** Never compare expected content (including cache hits) to compressed network
 * traffic. Retain both independent units and any missing decode evidence. */
export function transportEvidence(receipts) {
  const unknown = receipts.filter(row => !Number.isSafeInteger(row.decodedBodyBytes) || row.decodedBodyBytes < 0);
  return { wireBodyBytes: receipts.reduce((sum, row) => sum + row.bodyBytes, 0),
    networkContentBytes: unknown.length > 0 ? null : receipts.reduce((sum, row) => sum + row.decodedBodyBytes, 0),
    unknownContentResponses: unknown.length, responses: receipts.length,
    expectedUnit: 'file content before HTTP compression; includes cache hits',
    observedUnit: 'HTTP response bodies; excludes cache hits and headers' };
}


/** Wait for this exact candidate to become waiting; observing state never retries an install. */
export function waitForWaitingWorker(registration, timeoutMs = 120000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return Promise.reject(new Error('Invalid worker state deadline'));
  if (registration.waiting !== null) return Promise.resolve(registration.waiting);
  const candidate = registration.installing;
  if (candidate === null) return Promise.reject(new Error('No new worker installing or waiting'));
  return new Promise((resolve, reject) => {
    /** @type {{poll?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout>}} */
    const timers = {};
    /** @param {Error} [error] */
    const finish = (error) => {
      clearInterval(timers.poll); clearTimeout(timers.deadline);
      if (error !== undefined) reject(error); else resolve(candidate);
    };
    const check = () => {
      if (registration.waiting === candidate) finish();
      else if (registration.waiting !== null || (registration.installing !== null && registration.installing !== candidate)) finish(new Error('Upgrade worker candidate changed'));
      else if (candidate.state === 'redundant' || candidate.state === 'activated') finish(new Error(`Upgrade worker became ${candidate.state}`));
    };
    timers.poll = setInterval(check, 25);
    timers.deadline = setTimeout(() => { finish(new Error('Upgrade worker did not become waiting before deadline')); }, timeoutMs);
    check();
  });
}
