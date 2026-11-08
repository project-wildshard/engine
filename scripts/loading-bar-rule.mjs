// LS3 (J188): "as long as that loading bar moves at least 1% every 2 seconds, then it's not a frustrating experience."
// Pure reading of a recorded boot: no browser, no clock. scripts/loading-card-proof.mjs records the log on real boots;
// test/loading-bar-rule.test.mjs pins the rule's edges.

export const STALL_MS = 2000;
export const STEP_PCT = 1;
const MOMENT_MS = 5;

/**
 * @typedef {{t: number, bar: string, pct: number, step: string, atomic: number, bytes: number, files: number, work?: string}} BarRow
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
    if (gained >= STEP_PCT) close(row.t);
  }
  close(end);
  return { stalls, backwards };
}

/** Bar changes with no real event under them: none of LS1's counters and not the card's step moved since the last row.
 * @param {readonly BarRow[]} log */
export function untracedChanges(log) {
  const rows = [...log].sort((a, b) => a.t - b.t);
  /** @type {BarRow[]} */ const untraced = [];
  // Rows within MOMENT_MS of each other are one moment (a step change and the bar it moves land in separate observer
  // callbacks of the same paint): a bar row is traced when its event signature differs from the previous moment's.
  const signature = (/** @type {BarRow} */ row) => `${row.atomic}|${row.bytes}|${row.files}|${row.step}|${row.work ?? ''}`;
  /** @type {string | undefined} */ let previous;
  /** @type {string | undefined} */ let latest;
  let momentAt = Number.NEGATIVE_INFINITY;
  /** @type {Set<string>} */ const seen = new Set();
  for (const row of rows) {
    if (row.t - momentAt > MOMENT_MS) { previous = latest; momentAt = row.t; }
    // A bar's first reading at 0 is the card's initial state, not a change.
    const initial = !seen.has(row.bar) && row.pct === 0; seen.add(row.bar);
    if (!initial && previous !== undefined && row.bar !== 'step' && signature(row) === previous) untraced.push(row);
    latest = signature(row);
  }
  return untraced;
}
