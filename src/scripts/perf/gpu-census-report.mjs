/** Summarize matched samples; preserve signed no-op/noise and negative savings.
 * @param {{baseline:number,off:number,baselineCpu:number,offCpu:number}[]} pairs */
export function gpuPairs(pairs) {
  if (pairs.length === 0) throw new Error('Missing paired GPU throughput samples');
  for (const pair of pairs) if (!Object.values(pair).every(n => Number.isFinite(n) && n >= 0) || pair.baseline === 0) throw new Error('Invalid paired GPU throughput sample');
  const median = values => { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.floor(sorted.length / 2)]; };
  return {baseline:median(pairs.map(p=>p.baseline)),off:median(pairs.map(p=>p.off)),saved:median(pairs.map(p=>p.baseline-p.off)),
    baselineCpu:median(pairs.map(p=>p.baselineCpu)),offCpu:median(pairs.map(p=>p.offCpu)),pairs};
}
/** A frame-ratio model, never an independent phone GPU timer.
 * @param {number} macThroughputMs @param {number} phoneFrameMs */
export function gpuPhoneModel(macThroughputMs, phoneFrameMs) {
  if (![macThroughputMs,phoneFrameMs].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid GPU calibration anchor');
  return {kind:'phone-frame / Mac-throughput MODEL',macThroughputMs,phoneFrameMs,factor:phoneFrameMs/macThroughputMs,officialTimingCredit:false};
}
