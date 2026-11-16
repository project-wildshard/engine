/** @param {{reached?:boolean,under?:number,falls?:number,corrections?:number,forcedFrames?:number,forcedFrameMs?:number,spanSamples?:number,lowest?:number|null}} sample */
export function bridgeVerdict(sample) {
  const counts = [sample.under, sample.falls, sample.corrections, sample.forcedFrames, sample.spanSamples];
  const replayExercised = Number.isSafeInteger(sample.corrections) && Number(sample.corrections) > 0;
  return { ...sample, replayExercised, ok: counts.every(value => Number.isSafeInteger(value) && Number(value) >= 0)
    && sample.reached === true && sample.under === 0 && sample.falls === 0
    && replayExercised && Number(sample.forcedFrames) > 0 && sample.forcedFrameMs === 60
    && Number(sample.spanSamples) > 0 && typeof sample.lowest === 'number' && Number.isFinite(sample.lowest) };
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
