/** @param {{reached?:boolean,under?:number,falls?:number,corrections?:number,injectedSinks?:number[],forcedFrames?:number,forcedFrameMs?:number,spanSamples?:number,lowest?:number|null}} sample */
export function bridgeVerdict(sample) {
  const counts = [sample.under, sample.falls, sample.corrections, sample.forcedFrames, sample.spanSamples];
  const replayExercised = sample.injectedSinks?.length === 2 && sample.injectedSinks[0] === 0.3 && sample.injectedSinks[1] === 1;
  return { ...sample, replayExercised, ok: counts.every(value => Number.isSafeInteger(value) && Number(value) >= 0)
    && sample.reached === true && sample.under === 0 && sample.falls === 0
    && replayExercised && Number(sample.corrections) >= 2 && Number(sample.forcedFrames) > 0 && sample.forcedFrameMs === 60
    && Number(sample.spanSamples) > 0 && typeof sample.lowest === 'number' && Number.isFinite(sample.lowest) };
}

/** Intercept actual reconciliation, including live input's synchronous frame
 * delivery path. Only a copied owner argument changes; wire caches stay intact.
 * Self-contained for page.evaluate. */
export function installBridgeCorrections() {
  const W = /** @type {any} */ (window), state = W.__netLag, observed = W.__workerClientNet?.();
  if (observed === undefined) throw new Error('Missing developer prediction probe');
  const { client, predictor } = observed, original = predictor.reconcile;
  const player = W.__wildshard.world.player;
  const fault = state.bridgeFault = { ready: false, armed: 0, confirmed: /** @type {any[]} */ ([]), cleanup: () => undefined };
  const pending = new Map();
  const marker = Float64Array.from({ length: client.latest?.owner.length ?? 0 }, (_, index) => index + 1000);
  const py = marker.indexOf(client.owner({ owner: marker }).py);
  if (py === -1) throw new Error('Cannot locate owner feet column');
  /** @this {any} @param {number} seq @param {ArrayLike<number>} owner @param {number|undefined} tick @param {ArrayLike<number>|null|undefined} ride */
  function inject(seq, owner, tick, ride) {
    const at = player.position, along = ((at.x - 15.29) + (at.z - 13.29)) / (2 * (34.38 - 15.29));
    if (fault.armed !== 0 && state.slowMs === 60 && Number.isSafeInteger(tick) && along > 0.2 && along < 0.8) {
      const copy = new Float64Array(owner), fromY = client.owner({ owner }).py;
      copy[py] = (copy[py] ?? 0) - fault.armed;
      const toY = client.owner({ owner: copy }).py;
      if (Math.abs(fromY - toY - fault.armed) > 1e-6) throw new Error('Owner feet encoding changed');
      pending.set(tick, { sink: fault.armed, tick, fromY, toY });
      return original.call(this, seq, copy, tick, ride);
    }
    return original.call(this, seq, owner, tick, ride);
  }
  const offCorrection = client.onCorrection((/** @type {any} */ row) => {
    const injected = pending.get(row.tick);
    if (injected === undefined || fault.armed === 0) return;
    fault.confirmed.push({ ...injected, offset: row.offset }); fault.armed = 0; pending.clear();
  });
  fault.cleanup = () => { if (predictor.reconcile === inject) predictor.reconcile = original; offCorrection(); pending.clear(); };
  predictor.reconcile = inject;
  fault.ready = true;
}

/** The boost's speed on staging, in m/s (NL15). */
export const BOOST_SPEED = 14;
/**
 * NET-LAG NL15/NL17: how many seconds the boost goes back over the walked ground before turning on again: 60% of the
 * phase, but never further than 80% of the ground the walk and sprint actually covered. Nalati's sprint stuck after 3 m
 * (staging v0.1.50), so 60% of a 20 s boost (168 m) went 75 m past the spawn and out of the cell (4 to 0).
 * @param {number} seconds the phase
 * @param {number} walked metres from the walk's start to the sprint's end
 */
export function boostBack(seconds, walked) {
  return Math.max(0, Math.min(Math.round(seconds * 0.6), Math.floor(0.8 * walked / BOOST_SPEED)));
}

/** NET-LAG NL16: why headless WebKit's frame pacing is read on the stand-ins rather than judged here. */
export const WEBKIT_PACING = 'headless WebKit paces frames without a vsync snap and stamps them in whole ms: an idle page reads p99 19 to 29 ms (Chromium 16.8), a 28 ms GPU frame 28 to 49 ms (NL16); its p99 and 2x-budget frames are read on the iOS Simulator stand-in (NL11, J423), its frames over 50 ms stay judged';

/**
 * B1: no drawn frame over 2x the budget nor over 50 ms, p99 at most 1.25x the budget. NL16's second branch: in headless
 * WebKit only the 50 ms line is judged; the p99 and 2x lines are reported with `pacing` saying where they are read.
 * @param {string} engine
 * @param {{ over2x: number, over50: number, p99: number }[]} phases
 * @param {number} budgetMs
 */
export function b1Verdict(engine, phases, budgetMs) {
  const over2x = phases.reduce((sum, phase) => sum + phase.over2x, 0), over50 = phases.reduce((sum, phase) => sum + phase.over50, 0);
  const p99 = Math.max(...phases.map(phase => phase.p99)), paced = over2x === 0 && p99 <= 1.25 * budgetMs;
  const row = { budgetMs: Number(budgetMs.toFixed(1)), over2x, over50, p99 };
  return engine === 'webkit' ? { ...row, pacing: WEBKIT_PACING, ok: over50 === 0 } : { ...row, ok: paced && over50 === 0 };
}

/**
 * B3: the interpolation delay at most 120 ms from 10 s after entry, and no frame held past the buffer. NET-LAG NL17: B4's
 * forced 60 ms frames hold the page's thread, so frames are stamped late and the delay rises to cover a stall the proof made
 * (staging v0.1.50, Driftwood: jitter 2 to 6 ms on the wire, 120 to 134 ms on the bridge, delay 175 ms). That stall gets the
 * same 10 s to settle that entry gets: `forcedEndMs`, from entry, is when the forced frames stopped.
 * @param {{ t: number, delay: number }[]} delays samples, `t` in ms from entry
 * @param {number} heldFrom the interpolator's held count at entry
 * @param {number} heldAfter the same count at the run's end
 * @param {number} [forcedEndMs]
 */
export function b3Verdict(delays, heldFrom, heldAfter, forcedEndMs = 0) {
  const settled = Math.max(10_000, forcedEndMs + 10_000), late = delays.filter(sample => sample.t >= settled);
  const delayMaxAfter10s = late.length === 0 ? null : Math.max(...late.map(sample => sample.delay)), held = heldAfter - heldFrom;
  return { delayMaxAfter10s, held, fromSeconds: settled / 1000, ok: delayMaxAfter10s !== null && delayMaxAfter10s <= 120 && held === 0 };
}

/** Correctness runs cannot certify frame, correction-rate or clock timings.
 * @param {Record<string, any>} row
 * @param {'correctness'|'timing'|'vehicle'} mode
 * @returns {Record<string, any>} */
export function proofVerdict(row, mode) {
  if (mode === 'vehicle') { // MSZ16: the vehicle run reports its corrections a minute; it passes when it boarded and drove
    const { b1: _b1, b2: _b2, b3: _b3, ...result } = row;
    return { ...result, measurement: mode, checked: ['vehicle'], ok: row.error === undefined && (row.errors?.length ?? 0) === 0 && row.vehicle?.ok === true };
  }
  if (mode === 'correctness') {
    const { b1: _b1, b2: _b2, b3: _b3, ...result } = row;
    return { ...result, measurement: mode, checked: ['b4'], ok: row.error === undefined && (row.errors?.length ?? 0) === 0 && row.b4?.ok === true };
  }
  return { ...row, measurement: mode, checked: ['b1', 'b2', 'b3', ...(row.b4 === undefined ? [] : ['b4'])],
    ok: row.error === undefined && (row.errors?.length ?? 0) === 0 && row.b1?.ok === true && row.b2?.ok === true && row.b3?.ok === true && (row.b4?.ok ?? true) };
}
