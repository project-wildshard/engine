#!/usr/bin/env node
// MEMORY-STRUCTURE STR22: the hosted walk ratchet (walkRatchet.mjs). Nine's walk on the online boot of the exact prepared
// client, the pinned number of runs, compared with scripts/memory/walk-ratchet.json. Blocking: a completed worse reading
// exits 1. A walk that never completed (runner, browser, a boot short of control) is a warning and exits 0.
//   node scripts/memory/walk-ci.mjs <preview root> <output dir> [--record]
// --record re-pins downward (repinWalk) and writes the next baseline to <output dir>/walk-ratchet.json; the committed one
// is still the line this run is judged by.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { compareWalk, repinWalk, walkBaseline } from './walkRatchet.mjs';

const [root, output, flag, ...extra] = process.argv.slice(2);
if (!root || !output || extra.length > 0 || (flag !== undefined && flag !== '--record')) throw new Error('Usage: memory/walk-ci.mjs <preview root> <output> [--record]');
const baseline = walkBaseline(), directory = absolute(output), file = join(directory, `walk-${baseline.zone}.json`);
mkdirSync(directory, { recursive: true });
/** @param {string} line */
const summary = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`); };

const command = [process.execPath, 'scripts/memory/measure.mjs', '--online', `--walk=${String(baseline.seconds)}`, `--dist=${absolute(root, 'dist')}`,
  `--chunk=${baseline.zone}`, `--runs=${String(baseline.runs)}`, '--timeout=180', `--scratch=${join(directory, 'online')}`, `--out=${file}`];
const [bin, ...args] = process.platform === 'darwin' ? ['bash', 'scripts/browser-lane.sh', ...command] : command;
const child = spawn(bin, args, { stdio: 'inherit' });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
if (data?.walk?.complete !== true) {
  // an outage reports: nothing was read, so nothing is judged
  console.log(`::warning title=walk ratchet::${baseline.zone} walk did not complete (measure exited ${String(code)}); no reading, nothing judged`);
  summary(`Walk ratchet: ${baseline.zone} walk did not complete (measure exited ${String(code)}); reported, not judged`);
} else {
  const walk = data.walk, mb = (/** @type {number} */ b) => (b / 1e6).toFixed(2);
  summary(`Walk ratchet ${baseline.zone} (${String(walk.bytesPerSecond.n)} runs): ${mb(walk.bytesPerSecond.median)} MB/s allocated [S] (pinned ${mb(baseline.rate.value)}), `
    + `WebContent peak ${mb(walk.peakAboveSettled.median)} MB above settled [K] (pinned ${mb(baseline.peak.value)})`);
  if (flag === '--record') {
    const next = join(directory, 'walk-ratchet.json');
    writeFileSync(next, `${JSON.stringify(repinWalk(baseline, walk, process.env.GITHUB_SHA ?? 'local'), null, 2)}\n`);
    console.log(`next baseline: ${next}`);
  }
  const failure = compareWalk(baseline, walk);
  if (failure !== null) throw new Error(`Walk ratchet: ${failure}`);
  console.log(`Walk ratchet passed for ${baseline.zone}`);
}
