#!/usr/bin/env node
// MEMORY-STRUCTURE STR22: the hosted walk ratchet (walkRatchet.mjs). Nine's walk on the online boot of the exact prepared
// client, the pinned number of runs, its allocation rate judged through the budget verdict (BUDGET-CAPS BC11; the
// baseline is walk/<zone>/rate in budgets/baselines.json). J431: a first median over the line is re-measured (as many
// runs again) and fails only if the re-measure agrees; a re-measure that clears it is a warning naming the commit (a
// one-off spike: a QA row, not a red). The peak is reported, not judged, while it is bimodal. A first walk that never
// completed (runner, browser, a boot short of control) fails the step: meta QA 11-26 row 75 found every sampled run
// from 11-26 on with its Chromium walk stalled at loading step `server`, only a warning, so nothing was judged for days.
// So does a walk shorter than measure.mjs MIN_WALK_METRES_PER_SECOND allows (row 79: the rig's player stood still).
// A re-measure that never completed leaves the first reading's spike verdict.
//   node src/scripts/memory/walk-ci.mjs <preview root> <output dir> [--record]
// Every completed walk writes <output dir>/budget-measures.json with the table; `node src/scripts/budgets/cli.mjs record
// --run <id>` records it. --record is accepted for the workflow's shared switch and changes nothing here.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { readBaselines, readCaps } from '../budgets/files.mjs';
import { pinnedContentKeys } from '../shard-size-gate.mjs';
import { reportLedger, zoneContentKey } from './ledgerVerdict.mjs';
import { reportedLines, walkBaseline, walkRateRow, walkVerdict } from './walkRatchet.mjs';

const [root, output, flag, ...extra] = process.argv.slice(2);
if (!root || !output || extra.length > 0 || (flag !== undefined && flag !== '--record')) throw new Error('Usage: memory/walk-ci.mjs <preview root> <output> [--record]');
const baseline = walkBaseline(), directory = absolute(output);
const judging = { contentKey: zoneContentKey(baseline.zone, pinnedContentKeys()), budgets: { caps: readCaps(), baselines: readBaselines() } };
mkdirSync(directory, { recursive: true });
/** @param {string} line */
const summary = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`); };
const mb = (/** @type {number} */ b) => (b / 1e6).toFixed(2), commit = process.env.GITHUB_SHA ?? 'local';

/** One measure.mjs walk of the pinned runs into `name`; its summary and each run's peak, or null when it did not complete.
 * @param {string} name */
async function walk(name) {
  const file = join(directory, name);
  const command = [process.execPath, 'src/scripts/memory/measure.mjs', '--online', `--walk=${String(baseline.seconds)}`, `--dist=${absolute(root, 'dist')}`,
    `--chunk=${baseline.zone}`, `--runs=${String(baseline.runs)}`, '--timeout=180', `--scratch=${join(directory, 'online')}`, `--out=${file}`];
  const [bin, ...args] = process.platform === 'darwin' ? ['bash', 'src/scripts/browser-lane.sh', ...command] : command;
  const child = spawn(bin, args, { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (data?.walk?.complete !== true) {
    // QA 11-26 row 79: a walk under the least distance is no walk; its idle traffic is never judged as the walk's
    const short = data?.walk?.short?.length > 0 ? `, walked ${data.walk.short.join(', ')} m of the ${String(data.walk.leastMetres)} m a walk must cover` : '';
    console.log(`${name}: ${baseline.zone} walk did not complete (measure exited ${String(code)}${short}); no reading`);
    return null;
  }
  const peaks = /** @type {number[]} */ (data.webkit.map((/** @type {any} */ r) => r.walk?.aboveSettled?.webcontent).filter((/** @type {unknown} */ v) => typeof v === 'number'));
  const rate = walkRateRow(baseline, data.walk, judging);
  const soft = rate.line === null ? 'none: new content, record it' : mb(rate.line);
  summary(`Walk ratchet ${baseline.zone} (${name}, ${String(data.walk.bytesPerSecond.n)} runs): ${mb(data.walk.bytesPerSecond.median)} MB/s allocated [S] (${rate.status}, baseline ${rate.baseline === null ? 'none' : mb(rate.baseline)} on ${rate.previousKey ?? '-'}, line ${soft}), WebContent peak ${mb(data.walk.peakAboveSettled.median)} MB above settled [K]`);
  for (const line of reportedLines(baseline, data.walk, peaks)) summary(line);
  return data.walk;
}

const first = await walk(`walk-${baseline.zone}.json`);
if (first === null) {
  summary(`Walk ratchet: ${baseline.zone} walk did not complete; nothing judged, a red (QA 11-26 row 75)`);
  console.log(`::error title=walk ratchet::${baseline.zone} walk did not complete, so nothing was judged; its measure output above names the step it stalled at`);
  process.exitCode = 1;
}
else {
  const over = walkVerdict(baseline, first, null, judging).state !== 'pass';
  const again = over ? await walk(`walk-${baseline.zone}-again.json`) : null;
  const verdict = walkVerdict(baseline, first, again, judging);
  // the judged reading: the re-measure's when it ran and completed, else the first
  const judged = again?.complete === true ? again : first;
  reportLedger({ rows: [walkRateRow(baseline, judged, judging)], mode: 'walk', directory, commit: process.env.GITHUB_SHA, summaryFile: process.env.GITHUB_STEP_SUMMARY });
  if (verdict.state === 'fail') throw new Error(`Walk ratchet (first median and its re-measure agree): ${String(verdict.failure)}`);
  if (verdict.state === 'spike') {
    // J431: a one-off spike is a warning plus a QA row naming the commit
    console.log(`::warning title=walk ratchet spike::${commit}: ${String(verdict.failure)}; the re-measure ${again === null ? 'did not complete' : 'cleared it'}. Add a QA row naming ${commit}.`);
    summary(`Walk ratchet: one-off spike on ${commit} (${String(verdict.failure)}), re-measure ${again === null ? 'incomplete' : 'inside the line'}: warning, add a QA row`);
  } else console.log(`Walk ratchet passed for ${baseline.zone}`);
}
