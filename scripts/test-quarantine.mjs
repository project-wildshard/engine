// J193: one auditable selection for blocking and non-blocking CI cohorts.
import {appendFileSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve as resolvePath} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Read committed policy, refusing malformed or ambiguous entries. */
export function readQuarantine() {
  const raw = /** @type {unknown} */ (JSON.parse(readFileSync(new URL('../test/quarantine.json', import.meta.url), 'utf8')));
  if (!record(raw) || raw.schema !== 1 || !Array.isArray(raw.entries)) throw new Error('Invalid J193 quarantine policy');
  /** @type {Set<string>} */ const seen = new Set();
  return raw.entries.map((/** @type {unknown} */ value) => {
    if (!record(value) || typeof value.file !== 'string' || typeof value.owner !== 'string'
      || typeof value.deadline !== 'string' || typeof value.reason !== 'string') throw new Error('Incomplete quarantine entry');
    const {file, owner, deadline, reason} = value;
    if (!/^test\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.test\.(?:ts|mjs)$/u.test(file)
      || !/^[a-z][a-z0-9_-]+$/u.test(owner) || !Number.isFinite(Date.parse(deadline)) || reason.length < 8 || seen.has(file)) throw new Error('Invalid quarantine identity, deadline or reason');
    seen.add(file);
    return {file, owner, deadline, reason};
  });
}

/** Expiry restores blocking coverage automatically; it never drops a test. */
export function activeQuarantineFiles(now = Date.now()) {
  return readQuarantine().filter(entry => Date.parse(entry.deadline) > now).map(entry => entry.file);
}

async function main() {
  const args = process.argv.slice(2), shardArgs = args.filter(arg => arg.startsWith('--shard='));
  if (shardArgs.length > 1 || args.some(arg => arg !== '--list' && !arg.startsWith('--shard='))) throw new Error('Expected --list and at most one --shard=i/n');
  const shard = shardArgs[0]?.slice(8) ?? '1/1';
  if (!/^[1-9]\d*\/[1-9]\d*$/u.test(shard)) throw new Error('Invalid quarantine shard');
  const parts = shard.split('/'), index = Number(parts[0]), count = Number(parts[1]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) throw new Error('Invalid quarantine shard bounds');
  const entries = readQuarantine(), active = activeQuarantineFiles();
  // Partition committed entry positions, so expiry never moves another file
  // between shards. Every active entry has exactly one owner group.
  const files = entries.filter((entry, position) => position % count === index - 1 && active.includes(entry.file)).map(entry => entry.file);
  const rows = entries.map(entry => ({file: entry.file, owner: entry.owner, deadline: entry.deadline, reason: entry.reason, active: active.includes(entry.file), selected: files.includes(entry.file)}));
  console.log('J193 quarantine policy', JSON.stringify(rows));
  if (process.argv.includes('--list')) return 0;
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary,
    `### J193 quarantine ${shard} (non-blocking, executed separately)\n\n${rows.map(row => {
      let status = 'expired — blocking again';
      if (row.active) status = row.selected ? 'executed here' : 'another shard';
      return `- ${row.file}: owner ${row.owner}, deadline ${row.deadline}; ${status}`;
    }).join('\n')}\n`);
  if (files.length === 0) { console.log('No active files in this quarantine shard.'); return 0; }
  const report = resolvePath(process.env.WS_QUARANTINE_REPORT ?? `tmp/quarantine/results-${index}-of-${count}.json`);
  mkdirSync(dirname(report), {recursive: true});
  // This job installs full products even in ring-1: some of these files need
  // Driftwood and the whole road, beyond Ring 1's three-product inventory.
  /** @type {NodeJS.ProcessEnv} */ const env = {...process.env, WS_TEST_QUARANTINE: 'only'};
  delete env.WILDSHARD_RING;
  const child = spawn(process.execPath, [fileURLToPath(new URL('vitest-tmp.ts', import.meta.url)), 'run', ...files,
    '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${report}`], {env, stdio: 'inherit'});
  /** @type {Promise<number>} */ const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(signal === null ? code ?? 1 : 1)); });
  const code = await completed;
  const verdict = `J193 executed ${files.length} quarantined files; exit ${code}; original results ${report}`;
  console.log(verdict);
  if (summary) appendFileSync(summary, `\n${verdict}\n`);
  // Preserve the real exit status. Only the workflow's explicit
  // continue-on-error makes this cohort non-blocking.
  return code;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
