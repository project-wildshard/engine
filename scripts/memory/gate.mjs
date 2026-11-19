// J431. Compare cold boots on the same instrument and pin.
/** @typedef {Record<string, number>} Reading */
/** @typedef {{absolute?: number, baseline?: number, previousMargin?: number}} Limits */
/** @typedef {{kind: 'margin' | 'gate-flake', metric: string, arm: 'absolute' | 'ratchet', bytes: number, limit: number, median?: number}} Warning */

export const ratchetMargin = (/** @type {number} */baseline) => Math.max(Math.floor(baseline * 0.02), 5_000_000);

/** @param {readonly number[]} values */
export function medianOfThree(values) {
  if (values.length !== 3 || values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Expected three valid cold memory readings');
  }
  return [...values].sort((a, b) => a - b)[1];
}

/** @param {Reading} reading @param {string} metric */
function bytes(reading, metric) {
  const value = reading[metric];
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid memory measurement for ${metric}`);
  return value;
}

/** @param {Record<string, Limits>} metrics @param {Reading} reading */
function overages(metrics, reading) {
  return Object.entries(metrics).flatMap(([metric, { absolute, baseline }]) => {
    const measured = bytes(reading, metric);
    /** @type {{metric: string, arm: 'absolute' | 'ratchet', limit: number, bytes: number}[]} */
    const result = [];
    if (absolute !== undefined && measured > absolute) result.push({ metric, arm: 'absolute', limit: absolute, bytes: measured });
    if (baseline !== undefined && measured > baseline + ratchetMargin(baseline)) {
      result.push({ metric, arm: 'ratchet', limit: baseline + ratchetMargin(baseline), bytes: measured });
    }
    return result;
  });
}

/** @param {Record<string, Limits>} metrics @param {readonly Reading[]} runs */
export function cleanRatchet(metrics, runs) {
  const baselines = Object.entries(metrics).filter(([, limits]) => limits.baseline !== undefined);
  if (runs.length !== 3 || runs.some(run => overages(metrics, run).length > 0)) {
    return Object.fromEntries(baselines.map(([metric, limits]) => [metric, Number(limits.baseline)]));
  }
  return Object.fromEntries(baselines.map(([metric, limits]) =>
    [metric, Math.min(Number(limits.baseline), medianOfThree(runs.map(run => bytes(run, metric))))]));
}

/**
 * Probe only the zone that crossed a ceiling. Three fresh boots decide both
 * arms. A confirmation after a spike does not propose a lower baseline.
 * @param {{zone:string, metrics:Record<string, Limits>, first:Reading,
 * remeasure:(count:number)=>Promise<readonly Reading[]>, warn:(warning:Warning)=>void, record?:boolean}} options
 */
export async function checkMemory({ zone, metrics, first, remeasure, warn, record = false }) {
  /** @type {readonly Reading[]} */
  let samples = [first];
  let initial = overages(metrics, first);
  if (record && initial.length === 0) {
    const rest = await remeasure(2);
    if (rest.length !== 2) throw new Error('Need two more cold boots to record a baseline');
    samples = [first, ...rest];
    const peak = Object.fromEntries(Object.keys(metrics).map(metric =>
      [metric, Math.max(...samples.map(run => bytes(run, metric)))]));
    initial = overages(metrics, peak);
  }
  if (initial.length > 0) {
    const runs = await remeasure(3);
    const medians = Object.fromEntries(Object.keys(metrics).map(metric =>
      [metric, medianOfThree(runs.map(run => bytes(run, metric)))]));
    const confirmed = overages(metrics, medians);
    for (const finding of initial) {
      const median = medians[finding.metric];
      if (median <= finding.limit) warn({ ...finding, kind: 'gate-flake', median });
    }
    if (confirmed.length > 0) throw new Error(confirmed.map(finding =>
      `${zone} ${finding.metric} (${finding.arm}, median of 3): ${finding.bytes} B > ${finding.limit} B`).join('\n'));
    return cleanRatchet(metrics, []);
  }
  for (const [metric, { baseline, previousMargin }] of Object.entries(metrics)) {
    if (baseline === undefined || previousMargin === undefined) continue;
    const limit = baseline + previousMargin, measured = bytes(first, metric);
    if (measured > limit) warn({ kind: 'margin', metric, arm: 'ratchet', bytes: measured, limit });
  }
  return cleanRatchet(metrics, samples);
}

/** @param {string} mode @param {string} zone @param {Warning} row */
export function memoryWarningLine(mode, zone, row) {
  return `MEMORY WARNING kind=${row.kind} mode=${mode} zone=${zone} metric=${row.metric} arm=${row.arm} bytes=${row.bytes} limit=${row.limit} delta=${row.bytes - row.limit}${row.median === undefined ? '' : ` median=${row.median}`}`;
}
