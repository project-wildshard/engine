#!/usr/bin/env node
// BUDGET-CAPS BC3 (meta docs/plans/BUDGET-CAPS-PLAN.md; J444). One command for every budget:
//
//   node src/scripts/budgets/cli.mjs check <measures.json> [--hard-only]   one table (also to GITHUB_STEP_SUMMARY);
//                                       exit 1 on regressed or over-hard, or only on over-hard with --hard-only
//   node src/scripts/budgets/cli.mjs record <measures.json> [--why "<why>"]   write the measured baselines with their
//                                       content keys, clearing declared; refuses a value over its hard cap
//   node src/scripts/budgets/cli.mjs record --run <id>   the same from a main run's `budgets` artifact (budgets.yml, BC10):
//                                       a pin lane runs it after its pin's first green main run
//   node src/scripts/budgets/cli.mjs declare <key> --why "<engine feature>"   an engine feature raises this budget in
//                                       this commit: the next check treats the key as new content
//   node src/scripts/budgets/cli.mjs merge <out.json> <in.json>...   one measures file from several (later wins)
//   node src/scripts/budgets/cli.mjs needs-confirmation <measures.json>   true if a noisy overage needs a retry
//   node src/scripts/budgets/cli.mjs confirm <measures.json> <fresh1> <fresh2> <fresh3>   attach the three fresh reads
//
// measures.json: { "commit"?: sha, "measures": { "<key>": { "value": n } | { "reads": [a, b, c] }, plus "contentKey",
// and an optional "detail": { "<part>": n } shown in the table only } }.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capFor, readBaselines, readCaps, writeBaselines } from './files.mjs';
import { judgedValue, missesHardLimit, verdict } from './verdict.mjs';
import { budgetResultLine } from './watch.mjs';

const STATUS = { ok: 'ok', raised: 'raised', regressed: 'REGRESSED', 'over-hard': 'OVER HARD', warning: 'WARNING', confirm: 'WARNING' };

/** @param {number | null | undefined} value @param {string} unit */
function show(value, unit) {
  if (value === null || value === undefined) return '-';
  if (unit !== 'bytes') return `${value} ${unit}`;
  return value >= 1e9 ? `${(value / 1e9).toFixed(3)} GB` : `${(value / 1e6).toFixed(2)} MB`;
}

/** Judge every measure against its cap and baseline.
 * @param {import('./files.mjs').BudgetCaps} caps @param {import('./files.mjs').BudgetBaselines} baselines
 * @param {{ measures: Record<string, { value?: number, reads?: number[], contentKey: string, detail?: Record<string, number> }> }} measures */
export function judgeAll(caps, baselines, measures) {
  const rows = [];
  for (const [key, measure] of Object.entries(measures.measures)) {
    const cap = capFor(caps, key);
    if (cap === undefined) {
      rows.push({ key, status: /** @type {const} */ ('unknown'), unit: 'bytes', value: null, baseline: null, line: null, hard: null, target: null, ratio: null, delta: null, previousKey: null, contentKey: measure.contentKey, detail: measure.detail });
      continue;
    }
    const recorded = baselines.baselines[key];
    const result = verdict({ measure: measure.reads ?? /** @type {number} */ (measure.value), baseline: recorded, hard: cap.hard, contentKey: measure.contentKey,
      declared: recorded?.declared !== undefined, kind: cap.kind, floor: cap.floor ?? 0, confirm: cap.confirm === true });
    rows.push(Object.assign(result, { key, unit: cap.unit, baseline: recorded?.value ?? null, previousKey: recorded?.contentKey ?? null, hard: cap.hard, target: cap.target ?? null, contentKey: measure.contentKey, detail: measure.detail }));
  }
  return rows;
}

/** One table, one line a budget. Nothing else is printed: no ::warning (BC7).
 * @param {ReturnType<typeof judgeAll>} rows */
export function budgetTable(rows) {
  const lines = ['| Budget | Status | Measure | Baseline | Soft line | Hard limit | Change | Note |', '|---|---|---|---|---|---|---|---|'];
  for (const row of rows) {
    const notes = [];
    if (row.status === 'unknown') notes.push('no cap entry in budgets/caps.json');
    if (row.status === 'warning') notes.push('within J431 noise margin');
    if (row.status === 'confirm') notes.push('unconfirmed: needs three fresh reads');
    if (row.status === 'raised') notes.push(row.previousKey === null ? `new: record ${row.contentKey}` : row.previousKey === row.contentKey ? 'declared: record it' : `${row.previousKey} → ${row.contentKey}: record it`);
    if (row.unit !== 'fps' && row.ratio !== null && row.ratio < 0 && row.status === 'ok') notes.push(`${Math.round(-row.ratio * 100)}% under baseline`);
    if (row.target !== null && row.value !== null && row.value > row.target) notes.push(`past the ${show(row.target, row.unit)} target`);
    if (row.detail !== undefined) notes.push(Object.entries(row.detail).map(([part, bytes]) => `${part} ${show(bytes, row.unit)}`).join(', '));
    const change = row.ratio === null ? '-' : `${row.ratio >= 0 ? '+' : ''}${(row.ratio * 100).toFixed(1)}%`;
    lines.push(`| ${row.key} | ${row.status === 'unknown' ? 'UNKNOWN' : row.status === 'over-hard' && row.unit === 'fps' ? 'BELOW FLOOR' : STATUS[row.status]} | ${show(row.value, row.unit)} | ${show(row.baseline, row.unit)} | ${show(row.line, row.unit)} | ${show(row.hard, row.unit)} | ${change} | ${notes.join('; ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** The exit verdict for judged rows: 1 when anything is over its hard cap or unknown, or (unless hard-only) regressed.
 * @param {ReturnType<typeof judgeAll>} rows @param {{ hardOnly?: boolean }} [options] */
export const failed = (rows, { hardOnly = false } = {}) =>
  rows.some(row => row.status === 'over-hard' || row.status === 'unknown' || (!hardOnly && row.status === 'regressed'));

/** New baselines from measures. Refuses (errors, file unchanged) a value over its hard cap or with no cap entry.
 * @param {import('./files.mjs').BudgetCaps} caps @param {import('./files.mjs').BudgetBaselines} baselines
 * @param {{ commit?: string, measures: Record<string, { value?: number, reads?: number[], contentKey: string }> }} measures
 * @param {{ why?: string, commit?: string }} [options] */
export function recordAll(caps, baselines, measures, { why, commit } = {}) {
  const errors = [], next = { ...baselines.baselines };
  for (const [key, measure] of Object.entries(measures.measures)) {
    const cap = capFor(caps, key);
    if (cap === undefined) { errors.push(`budget: ${key} has no cap entry in budgets/caps.json`); continue; }
    const value = judgedValue(cap.kind, measure.reads ?? /** @type {number} */ (measure.value));
    if (cap.hard !== null && missesHardLimit(cap.kind, value, cap.hard)) { errors.push(`budget: ${key} measures ${show(value, cap.unit)}, misses its ${show(cap.hard, cap.unit)} hard ${cap.kind === 'floor' ? 'floor' : 'cap'} (${cap.decision}); a hard cap moves only on Jake's word`); continue; }
    const sha = commit ?? measures.commit;
    next[key] = { value, contentKey: measure.contentKey, ...(sha === undefined ? {} : { commit: sha }), ...(why === undefined ? {} : { why }), ...(measure.detail === undefined ? {} : { detail: measure.detail }) };
  }
  return { errors, baselines: { ...baselines, baselines: next } };
}

/** Mark a budget as raised by an engine feature in this commit (J438's raise).
 * @param {import('./files.mjs').BudgetCaps} caps @param {import('./files.mjs').BudgetBaselines} baselines @param {string} key @param {string} why */
export function declareRaise(caps, baselines, key, why) {
  if (why === undefined || why.trim() === '') return { errors: ['budget: declare needs --why "<the engine feature>"'], baselines };
  if (capFor(caps, key) === undefined) return { errors: [`budget: ${key} has no cap entry in budgets/caps.json`], baselines };
  const row = baselines.baselines[key];
  if (row === undefined) return { errors: [], baselines, note: `budget: ${key} has no baseline yet, so it is already judged as new content` };
  return { errors: [], baselines: { ...baselines, baselines: { ...baselines.baselines, [key]: { ...row, declared: why } } } };
}

/** One measures file from several; a later file's key wins, and the first commit named is kept.
 * @param {readonly { commit?: string, measures: Record<string, any> }[]} files */
export function mergeMeasures(files) {
  const commit = files.find(file => file.commit !== undefined)?.commit;
  return { ...(commit === undefined ? {} : { commit }), measures: Object.assign({}, ...files.map(file => file.measures)) };
}

/** The `budgets` artifact of a budgets.yml run, downloaded with gh into `directory` (`budgets/measures.json` inside).
 * @param {string} run @param {string} directory */
export function downloadRun(run, directory) {
  execFileSync('gh', ['run', 'download', run, '--name', 'budgets', '--repo', 'project-wildshard/engine', '--dir', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** @param {string[]} argv @param {{ root?: string, env?: NodeJS.ProcessEnv, out?: (line: string) => void, err?: (line: string) => void,
 *   download?: (run: string, directory: string) => void }} [io] */
export function runCli(argv, { root, env = process.env, out = line => console.info(line), err = line => console.error(line), download = downloadRun } = {}) {
  const [command, ...rest] = argv;
  const flag = name => { const at = rest.indexOf(name); return at === -1 ? undefined : rest[at + 1]; };
  const valued = new Set(['--why', '--run']);
  const target = rest.find((arg, index) => !arg.startsWith('--') && !valued.has(rest[index - 1]));
  const caps = readCaps(root), baselines = readBaselines(root);
  const readMeasures = () => JSON.parse(readFileSync(resolve(target ?? ''), 'utf8'));
  if (command === 'needs-confirmation') {
    out(String(judgeAll(caps, baselines, readMeasures()).some(row => row.status === 'confirm')));
    return 0;
  }
  if (command === 'confirm') {
    const [, ...paths] = rest;
    if (target === undefined || paths.length !== 3) { err('budget: confirm needs a measures file and three fresh runs'); return 2; }
    const original = readMeasures();
    const fresh = paths.map(path => /** @type {import('./cli.mjs').BudgetMeasures} */ (JSON.parse(readFileSync(resolve(path), 'utf8'))));
    for (const row of judgeAll(caps, baselines, original)) {
      if (row.status !== 'confirm') continue;
      const reads = fresh.flatMap(file => {
        const sample = file.measures[row.key];
        if (sample?.contentKey !== row.contentKey || (sample.reads !== undefined && sample.reads.length !== 1)) return [];
        const value = sample.reads?.[0] ?? sample.value;
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [value] : [];
      });
      if (reads.length !== 3) {
        err(`budget: ${row.key} needs three comparable single reads for ${row.contentKey}`);
        return 1;
      }
      original.measures[row.key] = { contentKey: row.contentKey, reads };
    }
    writeFileSync(resolve(target), `${JSON.stringify(original, null, 1)}\n`);
    return 0;
  }
  if (command === 'check') {
    const rows = judgeAll(caps, baselines, readMeasures()), table = budgetTable(rows);
    out(table);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Budgets\n\n${table}\n`);
    // BC9: one line per failing row, which main-watch reads (an error annotation in Actions); nothing for a passing one.
    for (const row of rows) if (row.status === 'regressed' || row.status === 'over-hard') {
      const line = budgetResultLine(row);
      out(env.GITHUB_ACTIONS === 'true' ? `::error title=Budget ${row.status}::${line}` : line);
    }
    return failed(rows, { hardOnly: rest.includes('--hard-only') }) ? 1 : 0;
  }
  if (command === 'record') {
    const run = flag('--run');
    let measures;
    if (run === undefined) measures = readMeasures();
    else {
      if (!/^\d+$/u.test(run)) { err('budget: --run takes a budgets.yml run id'); return 2; }
      const directory = mkdtempSync(join(tmpdir(), 'budgets-run-'));
      try {
        download(run, directory);
        measures = JSON.parse(readFileSync(join(directory, 'budgets/measures.json'), 'utf8'));
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    const result = recordAll(caps, baselines, measures, { why: flag('--why') });
    for (const error of result.errors) err(error);
    if (result.errors.length > 0) return 1;
    writeBaselines(result.baselines, root);
    out(`budget: recorded ${Object.keys(measures.measures).length} baseline(s) in budgets/baselines.json${run === undefined ? '' : ` from run ${run}`}`);
    return 0;
  }
  if (command === 'declare') {
    const result = declareRaise(caps, baselines, target ?? '', flag('--why'));
    for (const error of result.errors) err(error);
    if (result.errors.length > 0) return 1;
    if (result.note !== undefined) out(result.note);
    else { writeBaselines(result.baselines, root); out(`budget: ${target} declared; commit budgets/baselines.json with the feature`); }
    return 0;
  }
  if (command === 'merge') {
    const [output, ...inputs] = rest.filter(arg => !arg.startsWith('--'));
    if (output === undefined || inputs.length === 0) { err('budget: merge <out.json> <in.json>...'); return 2; }
    const merged = mergeMeasures(inputs.map(file => JSON.parse(readFileSync(resolve(file), 'utf8'))));
    writeFileSync(resolve(output), `${JSON.stringify(merged, null, 1)}\n`);
    out(`budget: merged ${Object.keys(merged.measures).length} measure(s) into ${output}`);
    return 0;
  }
  err('usage: cli.mjs check <measures.json> [--hard-only] | record <measures.json> [--why <why>] | declare <key> --why <why> | merge <out.json> <in.json>...');
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = runCli(process.argv.slice(2));
