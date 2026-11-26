/** LL6: post-push qualification beside M1, without holding main-push's lock. */
import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepare, runRing3, shardRepos, type Aggregate, type Api} from './ring3.ts';
import {readerEnv} from './gh-limit.mjs';
import {assertNoLocalCandidates} from './local-candidates.ts';

export interface ShardCheck {
  readonly candidate: Aggregate;
  readonly baseline: Aggregate;
  verdict: 'pending' | 'pass' | 'regression' | 'inconclusive';
  rows: {repo: string; verdict: 'pass' | 'regression' | 'inconclusive'; reason: string}[];
}
interface Options {
  readonly api: Api;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly deadlineMs?: number;
  readonly pollMs?: number;
  readonly checkpoint?: (report: ShardCheck) => void;
}

export async function checkShards(candidate: string, baseline: string, repos: readonly string[], options: Options): Promise<ShardCheck> {
  if (candidate === baseline) throw new Error('Candidate and baseline must be different exact pushed commits');
  if (options.deadlineMs !== undefined && (options.deadlineMs <= 0 || options.deadlineMs > 20 * 60_000)) throw new Error('Shard checks are bounded to twenty minutes');
  const report: ShardCheck = {candidate: prepare(candidate, 'LOCAL-LINK candidate', repos), baseline: prepare(baseline, 'LOCAL-LINK baseline', repos), verdict: 'pending', rows: []};
  const checkpoint = (): void => { options.checkpoint?.(report); };
  // Receivers key concurrency by the engine input. Both legs therefore share one bounded deadline.
  await Promise.all([report.baseline, report.candidate].map(leg => runRing3(leg, {...options, issues: false, checkpoint})));
  report.rows = report.candidate.rows.map(row => {
    const before = report.baseline.rows.find(other => other.repo === row.repo);
    if (before?.shardSha === undefined || row.shardSha !== before.shardSha || row.runId === before.runId) return {repo: row.repo, verdict: 'inconclusive', reason: 'Receiver shard commit differs, is unavailable, or run identity was reused'};
    if (row.status === 'success') return {repo: row.repo, verdict: 'pass', reason: 'Exact candidate receiver passed'};
    if (before.status === 'success' && row.status === 'failure' && row.conclusion === 'failure') return {repo: row.repo, verdict: 'regression', reason: 'Same shard passes baseline and fails candidate; fix forward on main'};
    return {repo: row.repo, verdict: 'inconclusive', reason: `Candidate ${row.status}; baseline ${before.status}; inspect exact run URLs`};
  });
  report.verdict = report.rows.every(row => row.verdict === 'pass') ? 'pass' : report.rows.some(row => row.verdict === 'regression') ? 'regression' : 'inconclusive';
  checkpoint();
  return report;
}

/** Reads use the App quota; dispatches use the operator's existing gh login. No issue/comment writes. */
export const githubApi: Api = (method, path, body) => new Promise((resolve, reject) => {
  const child = spawn('gh', ['api', '--method', method, path, ...(body === undefined ? [] : ['--input', '-'])],
    {env: method === 'GET' ? readerEnv() : process.env, signal: AbortSignal.timeout(20_000)});
  let stdout = '', stderr = '';
  child.stdout.on('data', (part: Buffer) => { stdout += part.toString(); });
  child.stderr.on('data', (part: Buffer) => { stderr += part.toString(); });
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) { reject(new Error(`GitHub ${method} ${path}: ${stderr.slice(0, 500)}`)); return; }
    try { resolve(JSON.parse(stdout)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
  });
  child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
});

function pushed(sha: string): void {
  if (!/^[a-f0-9]{40}$/u.test(sha) || spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main']).status !== 0) {
    throw new Error(`Expected an exact commit already pushed to origin/main: ${sha}`);
  }
}

async function main(args: readonly string[]): Promise<void> {
  const values = new Map<string, string>();
  for (let at = 0; at < args.length; at += 2) {
    const key = args[at], value = args[at + 1];
    if (key === undefined || value === undefined || !['--candidate', '--baseline', '--shards', '--output'].includes(key) || values.has(key)) throw new Error('Usage: shard-check.ts --baseline <full sha> [--candidate <full sha>] [--shards repo,...] [--output path.json]');
    values.set(key, value);
  }
  assertNoLocalCandidates(process.cwd());
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'});
  const candidate = values.get('--candidate') ?? head.stdout.trim(), baseline = values.get('--baseline') ?? '';
  pushed(candidate); pushed(baseline);
  const repos = values.get('--shards')?.split(',') ?? shardRepos;
  prepare(candidate, 'LOCAL-LINK', repos);
  const output = values.get('--output') ?? 'tmp/shard-check/verdict.json';
  const save = (report: ShardCheck): void => { mkdirSync(dirname(output), {recursive: true}); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); };
  const report = await checkShards(candidate, baseline, repos, {api: githubApi, checkpoint: save});
  console.info(`shard check ${report.verdict}: ${output}`);
  for (const row of report.rows) console.info(`${row.repo}: ${row.verdict}; ${row.reason}`);
  if (report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) await main(process.argv.slice(2));
