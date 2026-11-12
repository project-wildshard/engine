// LS3 (J188, amended by J204): the bar never goes more than 2 s without a visible advance. J204 (Jake, 2026-11-09):
// "the bar just has to move, it can move by 0.1%, moving the bar from 91.2 to 91.3 every 2s etc is visible progress.
// Something has to progress every 2s". The card's bars and its Load number resolve tenths of a percent.
// Pure reading of a recorded boot: no browser, no clock. scripts/loading-card-proof.mjs records the log on real boots;
// test/loading-bar-rule.test.mjs pins the rule's edges.

export const STALL_MS = 2000;
export const STEP_PCT = 0.1;


/**
 * @typedef {{kind: string, done?: number, total?: number, bytes?: number, byteTotal?: number, complete?: boolean, configured?: boolean, adopted?: boolean, inline?: boolean, known?: boolean, rows?: {state:string, fraction?:number, weight?:number}[]}} ProducerReading
 * @typedef {{t: number, bar: string, pct: number, step: string, atomic: number, bytes: number, files: number, work?: string, source?: ProducerReading}} BarRow
 * `bar` is a phase bar (`start`, `download`, `load`) or `step`, a change of the card's current step with no bar change.
 * `atomic`, `bytes` and `files` are LS1's counters at that moment: completed boundaries, streamed body bytes, finished files.
 * `work` is the producer's own report: the running step's sub-progress and whether the download closed.
 */

/** Every stretch over 2 s in which the bars together took less than 1 %, between `start` and `end`, with the stages
 * the card named during it. A bar that runs backwards is its own finding.
 * @param {readonly BarRow[]} log @param {number} start @param {number} end */
export function barStalls(log, start, end) {
  const rows = [...log].sort((a, b) => a.t - b.t);
  /** @type {Map<string, number>} */ const shown = new Map();
  /** @type {{from: number, to: number, ms: number, stages: string[]}[]} */ const stalls = [];
  /** @type {{t: number, bar: string, from: number, to: number}[]} */ const backwards = [];
  let gained = 0, progressAt = start, step = '';
  /** @type {Set<string>} */ let stages = new Set();
  const close = (/** @type {number} */ at) => {
    if (at - progressAt > STALL_MS) stalls.push({ from: progressAt, to: at, ms: at - progressAt, stages: [...stages] });
    progressAt = at; gained = 0; stages = new Set(step === '' ? [] : [step]);
  };
  for (const row of rows) {
    if (row.t > end) break;
    if (row.step !== '') { step = row.step; stages.add(step); }
    if (row.bar === 'step') continue;
    const before = shown.get(row.bar) ?? 0;
    shown.set(row.bar, row.pct);
    if (row.pct < before) backwards.push({ t: row.t, bar: row.bar, from: before, to: row.pct });
    gained += Math.max(0, row.pct - before);
    // a tenth read from widths (91.2 -> 91.3) sums to 0.0999...: compare within float error
    if (gained >= STEP_PCT - 1e-9) close(row.t);
  }
  close(end);
  return { stalls, backwards };
}

/** Recompute the earned share from the relevant original producer, never labels,
 * clocks, unrelated realm counters or a percentage copied out of the card.
 * @param {ProducerReading | undefined} source @returns {number | null} */
function earned(source) {
  if (source === undefined) return null;
  /** @param {number | undefined} n @returns {n is number} */
  const valid = n => n !== undefined && Number.isFinite(n) && n >= 0;
  if (source.kind === 'start') {
    if (source.adopted === true) return 100;
    if (!valid(source.done) || !valid(source.total) || !valid(source.bytes) || !valid(source.byteTotal)
      || source.done > source.total || source.bytes > source.byteTotal || source.total === 0) return null;
    // Jake (2026-11-12): Start's percent is the ratio its head prints: code bytes, else boundaries; 100 waits for adoption
    return Math.min(99, Math.floor(100 * (source.byteTotal > 0 ? source.bytes / source.byteTotal : source.done / source.total)));
  }
  if (source.kind === 'download') {
    if (!valid(source.done) || !valid(source.total) || source.done > source.total) return null;
    if(source.complete===true)return 100;
    if(source.known===false)return 0;
    return source.inline===true?Math.min(99,Math.floor(source.total===0?0:100*source.done/source.total))
      :Math.floor(1000*(source.total===0?0:Math.min(.999,source.done/source.total)))/10;
  }
  if (source.kind !== 'load' || source.rows === undefined) return null;
  if (source.configured !== true) return 0;
  let done = 0, total = 0;
  for (const row of source.rows) {
    const weight = row.weight ?? 1;
    if (!valid(weight) || !['todo','on','ok'].includes(row.state)
      || row.fraction !== undefined && (!valid(row.fraction) || row.fraction >= 1)) return null;
    total += weight;
    if (row.state === 'ok') done += weight;
    else if (row.state === 'on') done += weight * (row.fraction ?? 0);
  }
  return total === 0 ? 0 : Math.floor(Math.min(1 - Number.EPSILON, done / total) * 1000) / 10;
}

/** Each visible reading must equal its own earned numeric share. Load retains
 * earned credit across path refinement, just as the presenter does. Initial
 * positive readings need evidence too; zero is the only source-free initial state.
 * @param {readonly BarRow[]} log */
export function untracedChanges(log) {
  /** @type {BarRow[]} */ const untraced = [];
  /** @type {Map<string,number>} */ const held = new Map();
  /** @type {Map<string,number>} */ const shown = new Map();
  for (const row of [...log].sort((a,b)=>a.t-b.t)) {
    if (row.bar === 'step') continue;
    let expected = row.source?.kind === row.bar ? earned(row.source) : null;
    // The real control-ready boundary earns the final 100. Its synchronous
    // handoff may first publish one last exact row-derived fraction before
    // closing the parent stage. Both are earned; intermediate guesses are not.
    if(row.bar==='load'&&row.source?.kind==='load'&&row.source.complete===true&&row.pct===100)expected=100;
    if (expected !== null && row.bar === 'load') {
      expected = Math.max(held.get(row.bar) ?? 0, expected); held.set(row.bar,expected);
    }
    const initialZero = !shown.has(row.bar) && row.pct === 0;
    if ((!initialZero && (expected === null || Math.abs(row.pct - expected) > .00001))
      || !Number.isFinite(row.pct) || row.pct < (shown.get(row.bar) ?? 0)) untraced.push(row);
    shown.set(row.bar,row.pct);
  }
  return untraced;
}
