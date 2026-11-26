// meta IPHONE13-DRIFTWOOD DW6 (mini-driftwood13, 2026-11-19): link-bench.mjs's table. Pure.

/** The stages between the marks, in seconds from the navigation: each stage ends at its mark and starts at the last one.
 * @param {Record<string, number|null|undefined>} at */
export function linkStages(at) {
  const marks = /** @type {const} */ ([['menu', 'menu'], ['deck', 'zone select'], ['enter', 'enter zone'], ['startDone', 'start'],
    ['downloadDone', 'download'], ['loadDone', 'load'], ['control', 'to control']]);
  /** @type {Record<string, number|null>} */
  const stages = {};
  let from = 0;
  for (const [key, label] of marks) {
    const mark = at[key];
    if (typeof mark !== 'number') { stages[label] = null; continue; }
    stages[label] = Math.round((mark - from) * 10) / 10;
    from = mark;
  }
  return stages;
}

/** @param {(number|null)[]} list */
const median = (list) => {
  const sorted = list.filter((value) => typeof value === 'number').sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
};

/** One row per run, then each kind's median, then the biggest stage by median.
 * @param {{kind: string, at: Record<string, number|null|undefined>, error?: string|null}[]} rows */
export function linkTable(rows) {
  const labels = Object.keys(linkStages({}));
  const lines = [`| Run | ${labels.join(' | ')} | total s | note |`, `|${'---|'.repeat(labels.length + 3)}`];
  rows.forEach((row, index) => {
    const stages = linkStages(row.at);
    lines.push(`| ${row.kind} ${String(index + 1)} | ${labels.map((label) => stages[label] ?? '—').join(' | ')} | ${String(row.at.control ?? '—')} | ${row.error ?? ''} |`);
  });
  /** @type {{kind: string, label: string, median: number}[]} */
  const biggest = [];
  for (const kind of new Set(rows.map((row) => row.kind))) {
    const mine = rows.filter((row) => row.kind === kind && (row.error === undefined || row.error === null));
    const medians = labels.map((label) => median(mine.map((row) => linkStages(row.at)[label] ?? null)));
    lines.push(`| **${kind} median** (${String(mine.length)}) | ${medians.map((value) => value ?? '—').join(' | ')} | ${String(median(mine.map((row) => row.at.control ?? null)) ?? '—')} | |`);
    const top = labels.map((label, i) => ({ kind, label, median: medians[i] ?? -1 })).sort((a, b) => b.median - a.median)[0];
    if (top !== undefined && top.median >= 0) biggest.push(top);
  }
  lines.push('', ...biggest.map((row) => `Biggest stage, ${row.kind}: **${row.label}**, median ${String(row.median)} s.`));
  return lines.join('\n');
}
