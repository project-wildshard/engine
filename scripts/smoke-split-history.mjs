// TEMPLATE-E2E TB-4a: compare like-for-like smoke splits with the preceding week.
// Storage and the real pack-decode fault drill belong to TB-4b.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MARKER = 'TEMPLATE_SMOKE ';
/** @typedef {{at:string,profile:string,split:Readonly<Record<string,number>>}} SmokeReceipt */

/** @param {unknown} value @returns {value is SmokeReceipt} */
function isReceipt(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('at' in value) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return false;
  if (!('profile' in value) || typeof value.profile !== 'string' || value.profile.length === 0) return false;
  if (!('split' in value) || typeof value.split !== 'object' || value.split === null || Array.isArray(value.split)) return false;
  const values = Object.values(value.split);
  return values.length > 0 && values.every(ms => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0);
}

/** Accept receipt lines mixed with the existing lane log; torn lines are not samples.
 * @param {string} text @returns {SmokeReceipt[]} */
export function readSmokeHistory(text) {
  const history = [];
  for (const line of text.split('\n')) {
    const offset = line.indexOf(MARKER);
    if (offset === -1) continue;
    try {
      const value = JSON.parse(line.slice(offset + MARKER.length));
      if (isReceipt(value)) history.push(value);
    } catch { /* A killed writer may leave a partial final line. */ }
  }
  return history;
}

/** @param {readonly number[]} values */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

/** Only preceding samples from the same cold/warm, platform and renderer profile count.
 * The caller supplies stable leaf names, so a nested parent is never counted twice.
 * @param {SmokeReceipt} current @param {readonly SmokeReceipt[]} history */
export function smokeSplitRegression(current, history) {
  if (!isReceipt(current)) throw new TypeError('Invalid smoke receipt');
  const now = Date.parse(current.at);
  const previous = history.filter(row => isReceipt(row) && row.profile === current.profile
    && Date.parse(row.at) < now && Date.parse(row.at) >= now - WEEK_MS);
  return Object.entries(current.split).map(([name, ms]) => {
    const samples = previous.flatMap(row => Object.hasOwn(row.split, name) ? [row.split[name]] : []).filter(value => value !== undefined);
    const baseline = samples.length === 0 ? null : median(samples);
    return { name, ms, medianMs: baseline, samples: samples.length,
      flagged: samples.length >= 3 && baseline !== null && (baseline === 0 ? ms > 0 : ms >= baseline * 1.3) };
  });
}
