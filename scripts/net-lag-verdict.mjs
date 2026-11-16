/** @param {{reached?:boolean,under?:number,falls?:number,corrections?:number,injectedSinks?:number[],forcedFrames?:number,forcedFrameMs?:number,spanSamples?:number,lowest?:number|null}} sample */
export function bridgeVerdict(sample) {
  const counts = [sample.under, sample.falls, sample.corrections, sample.forcedFrames, sample.spanSamples];
  const replayExercised = sample.injectedSinks?.length === 2 && sample.injectedSinks[0] === 0.3 && sample.injectedSinks[1] === 1;
  return { ...sample, replayExercised, ok: counts.every(value => Number.isSafeInteger(value) && Number(value) >= 0)
    && sample.reached === true && sample.under === 0 && sample.falls === 0
    && replayExercised && Number(sample.corrections) >= 2 && Number(sample.forcedFrames) > 0 && sample.forcedFrameMs === 60
    && Number(sample.spanSamples) > 0 && typeof sample.lowest === 'number' && Number.isFinite(sample.lowest) };
}

/** Observe the developer probe's actual room client. Self-contained for page.evaluate. */
export function installBridgeCorrections() {
  const W = /** @type {any} */ (window), state = W.__netLag, client = W.__workerClientNet?.();
  if (client === undefined) throw new Error('Missing developer NetClient probe');
  const player = W.__wildshard.world.player;
  const fault = state.bridgeFault = { ready: false, armed: 0, confirmed: /** @type {any[]} */ ([]), cleanup: () => undefined };
  const pending = new Map();
  // Discover py through the public decoder rather than pinning a wire index.
  const marker = Float64Array.from({ length: client.latest?.owner.length ?? 0 }, (_, index) => index + 1000);
  const py = marker.indexOf(client.owner({ owner: marker }).py);
  if (py === -1) throw new Error('Cannot locate owner feet column');
  const offFrame = client.onFrame((/** @type {any} */ frame) => {
    if (fault.armed === 0 || state.slowMs !== 60 || client.latest !== frame) return;
    const at = player.position, along = ((at.x - 15.29) + (at.z - 13.29)) / (2 * (34.38 - 15.29));
    if (along <= 0.2 || along >= 0.8) return;
    const owner = new Float64Array(frame.owner), fromY = client.owner(frame).py;
    owner[py] = (owner[py] ?? 0) - fault.armed;
    const replacement = { ...frame, owner }, toY = client.owner(replacement).py;
    if (Math.abs(fromY - toY - fault.armed) > 1e-6) throw new Error('Owner feet encoding changed');
    client.latest = replacement;
    pending.set(frame.tick, { sink: fault.armed, tick: frame.tick, fromY, toY });
  });
  const offCorrection = client.onCorrection((/** @type {any} */ row) => {
    const injected = pending.get(row.tick);
    if (injected === undefined || fault.armed === 0) return;
    fault.confirmed.push({ ...injected, offset: row.offset }); fault.armed = 0; pending.clear();
  });
  fault.cleanup = () => { offFrame(); offCorrection(); pending.clear(); };
  fault.ready = true;
}

/** Correctness runs cannot certify frame, correction-rate or clock timings.
 * @param {Record<string, any>} row
 * @param {'correctness'|'timing'} mode
 * @returns {Record<string, any>} */
export function proofVerdict(row, mode) {
  if (mode === 'correctness') {
    const { b1: _b1, b2: _b2, b3: _b3, ...result } = row;
    return { ...result, measurement: mode, checked: ['b4'], ok: row.error === undefined && (row.errors?.length ?? 0) === 0 && row.b4?.ok === true };
  }
  return { ...row, measurement: mode, checked: ['b1', 'b2', 'b3', ...(row.b4 === undefined ? [] : ['b4'])],
    ok: row.error === undefined && row.b1?.ok === true && row.b2?.ok === true && row.b3?.ok === true && (row.b4?.ok ?? true) };
}
