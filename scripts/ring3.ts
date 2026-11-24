// Ring 3: dispatch the exact candidate, then follow the returned run ID.
// workflow_dispatch reaches the same receiver as engine-candidate, and its
// return_run_details response avoids guessing which concurrent run is ours.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

/** QA-FEEDBACK-2026-11-23-b row 41: receivers whose candidate ci.yml restores a Ring 2 author preparation made for the exact install
 *  (their `Require matching preparation` step); the sender runs their ring-2-prepare.yml on it first. */
export const preparedRepos: readonly string[] = ['shard-sky-reach', 'shard-open-plots'];
export const shardRepos = ['shard-dunes', 'shard-sky-reach', 'shard-nalati', 'shard-nine-dragon', 'shard-driftwood', 'shard-pine-hollow', 'shard-open-plots'] as const;
interface Row {repo: string; prepareUrl?: string; status: 'pending' | 'success' | 'failure' | 'error' | 'timeout'; runId?: number; runUrl?: string; shardSha?: string; conclusion?: string | null; issue?: string; error?: string}
/** `packed`: the commit the receivers install, the candidate plus its npm archive's build outputs (ring3-pack.ts, QA 11-23-b row 40). */
interface Run {id: number; event: string; path: string; head_sha: string; status: string; conclusion: string | null; run_attempt: number}
export interface Aggregate {version: 1; engine: string; originRun: string; ok: boolean; rows: Row[]; packed?: string}
export type Api = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;
interface Options {api: Api; packed?: string; now?: () => number; sleep?: (ms: number) => Promise<void>; deadlineMs?: number; pollMs?: number; checkpoint?: (report: Aggregate) => void; issues?: boolean; misses?: number}
const errorText = (error: unknown): string => String(error).replaceAll(/[\r\n]/gu, ' ').slice(0, 1000);

export function prepare(engine: string, originRun: string, repos: readonly string[] = shardRepos): Aggregate {
  if (!/^[a-f0-9]{40}$/u.test(engine)) throw new Error('Ring 3 requires the full engine commit hash');
  if (repos.length === 0 || new Set(repos).size !== repos.length || repos.some(repo => !shardRepos.some(known => known === repo))) throw new Error('Ring 3 requires distinct known shard repos');
  return {version: 1, engine, originRun, ok: false, rows: repos.map(repo => ({repo, status: 'pending'}))};
}

export async function runRing3(report: Aggregate, options: Options): Promise<Aggregate> {
  const {api, now = Date.now, sleep = (ms: number): Promise<void> => new Promise(resolve => {setTimeout(resolve, ms);}), deadlineMs = 40 * 60_000, pollMs = 15_000, checkpoint = () => { /* Embedded callers may omit persisted receipts. */ }} = options;
  const until = now() + deadlineMs;
  if (options.packed !== undefined) {
    if (!/^[a-f0-9]{40}$/u.test(options.packed)) throw new Error('Ring 3 sends a full packed commit hash');
    report.packed = options.packed;
  }
  const install = report.packed ?? report.engine;
  // row 41: run 45331290922 lost four rows to one HTTP 404 on a run it had just been handed; a read fails a row only
  // after `misses` reads in a row fail (a refused identity still fails at once).
  const misses = options.misses ?? 5, missed = new Map<string, number>();
  const read = async (repo: string, id: number): Promise<Run | undefined> => {
    try {
      const run = await api('GET', `repos/project-wildshard/${repo}/actions/runs/${String(id)}`) as Run;
      missed.delete(`${repo}/${String(id)}`);
      return run;
    } catch (error) {
      const count = (missed.get(`${repo}/${String(id)}`) ?? 0) + 1;
      missed.set(`${repo}/${String(id)}`, count);
      if (count >= misses) throw error;
      return undefined;
    }
  };
  const dispatch = async (repo: string, workflow: string): Promise<number> => {
    const response = await api('POST', `repos/project-wildshard/${repo}/actions/workflows/${workflow}/dispatches`,
      {ref: 'main', inputs: {engine: install}, return_run_details: true}) as {workflow_run_id?: number};
    if (typeof response.workflow_run_id !== 'number' || !Number.isSafeInteger(response.workflow_run_id) || response.workflow_run_id <= 0) throw new Error('Dispatch returned no exact run ID; refusing to guess a run');
    return response.workflow_run_id;
  };
  // row 41: the exact-install preparation, green, before the receiver that restores it
  const prepared = async (row: Row): Promise<boolean> => {
    const id = await dispatch(row.repo, 'ring-2-prepare.yml');
    row.prepareUrl = `https://github.com/project-wildshard/${row.repo}/actions/runs/${String(id)}`;
    checkpoint(report);
    for (;;) {
      const run = await read(row.repo, id);
      if (run === undefined) {await sleep(Math.max(0, Math.min(pollMs, until - now()))); continue;}
      if (run.id !== id || run.path.split('@')[0] !== '.github/workflows/ring-2-prepare.yml') throw new Error('Preparation run identity changed');
      if (run.status === 'completed') {
        if (run.conclusion === 'success') return true;
        row.status = 'failure'; row.conclusion = run.conclusion; row.error = `ring-2-prepare ${row.prepareUrl} ended ${String(run.conclusion)}`;
        return false;
      }
      if (now() >= until) {row.status = 'timeout'; row.error = `ring-2-prepare ${row.prepareUrl} did not finish within the Ring 3 deadline`; return false;}
      await sleep(Math.max(0, Math.min(pollMs, until - now())));
    }
  };
  // All seven requests are independent; a refused shard must not hide the others.
  await Promise.all(report.rows.map(async row => {
    try {
      if (preparedRepos.includes(row.repo) && !await prepared(row)) {checkpoint(report); return;}
      row.runId = await dispatch(row.repo, 'ci.yml');
      row.runUrl = `https://github.com/project-wildshard/${row.repo}/actions/runs/${row.runId}`;
    } catch (error) {row.status = 'error'; row.error = errorText(error);}
    checkpoint(report);
  }));
  while (report.rows.some(row => row.status === 'pending') && now() < until) {
    await Promise.all(report.rows.filter(row => row.status === 'pending').map(async row => {
      try {
        const run = await read(row.repo, row.runId ?? 0);
        if (run === undefined) return;
        if (run.id !== row.runId || run.event !== 'workflow_dispatch' || run.path.split('@')[0] !== '.github/workflows/ci.yml' || !/^[a-f0-9]{40}$/u.test(run.head_sha) || run.run_attempt !== 1) throw new Error('Receiver run identity changed; new qualification required');
        row.shardSha = run.head_sha;
        if (run.status === 'completed') {row.conclusion = run.conclusion; row.status = run.conclusion === 'success' ? 'success' : 'failure';}
      } catch (error) {row.status = 'error'; row.error = errorText(error);}
      checkpoint(report);
    }));
    if (report.rows.some(row => row.status === 'pending')) await sleep(Math.max(0, Math.min(pollMs, until - now())));
  }
  for (const row of report.rows) if (row.status === 'pending') {row.status = 'timeout'; row.error = 'Receiver did not complete within the Ring 3 deadline';}
  // Deduplicate per candidate in each shard; cancelled/skipped/incomplete is never green.
  await Promise.all(report.rows.filter(row => options.issues !== false && row.status !== 'success' && row.runId !== undefined).map(async row => {
    try {
      const title = `[Ring 3] engine ${report.engine}`;
      const existing = await api('GET', `repos/project-wildshard/${row.repo}/issues?state=all&per_page=100&sort=created&direction=desc`) as {title: string; html_url: string; pull_request?: unknown}[];
      const prior = existing.find(issue => issue.pull_request === undefined && issue.title === title);
      if (prior !== undefined) row.issue = prior.html_url;
      else {
        const issue = await api('POST', `repos/project-wildshard/${row.repo}/issues`, {title,
          body: `Engine candidate: \`${report.engine}\`\n\nReceiver: ${row.runUrl}\n\nShard commit: \`${row.shardSha ?? 'unavailable'}\`\n\nVerdict: ${row.status} (${row.conclusion ?? row.error ?? 'incomplete'}).\n\nSender: ${report.originRun}\n\nFix forward (J165); this candidate is not release-qualified.`}) as {html_url: string};
        row.issue = issue.html_url;
      }
    } catch (error) {row.error = `${row.error ?? ''} Issue creation failed: ${errorText(error)}`.trim();}
    checkpoint(report);
  }));
  report.ok = report.rows.length > 0 && report.rows.every(row => row.status === 'success');
  checkpoint(report);
  return report;
}

export function markdown(report: Aggregate): string {
  return [`# Ring 3: ${report.ok ? 'GREEN' : 'RED — RELEASE HELD'}`, '', `Engine: \`${report.engine}\``, '',
    ...(report.packed === undefined ? [] : [`Installed as: \`${report.packed}\` (the candidate with its npm archive's build outputs)`, '']),
    '| Shard | Candidate run | Shard commit | Verdict | Issue |', '| --- | --- | --- | --- | --- |',
    ...report.rows.map(row => `| ${row.repo} | ${row.runUrl === undefined ? 'not dispatched' : `[${row.runId}](${row.runUrl})`} | ${row.shardSha?.slice(0, 12) ?? 'unknown'} | ${row.status} | ${row.issue === undefined ? '' : `[issue](${row.issue})`} |`),
    '', ...report.rows.filter(row => row.error !== undefined).map(row => `- ${row.repo}: ${row.error?.replaceAll(/[|<>]/gu, ' ')}`),
    '', 'This artifact aggregates candidate checks. It does not create a tag, release, upload or deployment.', ''].join('\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {RING3_ENGINE, RING3_ORIGIN_RUN, RING3_PACKED, GH_TOKEN} = process.env;
  const [command, directory = 'tmp/ring3'] = process.argv.slice(2);
  const save = (report: Aggregate): void => {mkdirSync(directory, {recursive: true}); writeFileSync(join(directory, 'verdict.json'), `${JSON.stringify(report, null, 2)}\n`); writeFileSync(join(directory, 'summary.md'), markdown(report));};
  if (command === 'prepare') save(prepare(RING3_ENGINE ?? '', RING3_ORIGIN_RUN ?? 'local'));
  else if (command === 'run') {
    const report = JSON.parse(readFileSync(join(directory, 'verdict.json'), 'utf8')) as Aggregate;
    // Revalidate the persisted candidate before any write request.
    if (JSON.stringify(report) !== JSON.stringify(prepare(report.engine, report.originRun))) throw new Error('Ring 3 must start from a fresh prepared aggregate');
    const token = GH_TOKEN;
    if (token === undefined || token === '') throw new Error('Ring 3 needs the dedicated nightly App token');
    const api: Api = async (method, path, body) => {
      const response = await fetch(`https://api.github.com/${path}`, {method, signal: AbortSignal.timeout(20_000),
        headers: {accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...(body === undefined ? {} : {'content-type': 'application/json'})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}; check nightly App installation and Actions/Issues permissions`);
      return response.json();
    };
    await runRing3(report, {api, checkpoint: save, ...(RING3_PACKED === undefined || RING3_PACKED === '' ? {} : {packed: RING3_PACKED})});
    console.log(markdown(report));
    if (!report.ok) process.exitCode = 1;
  } else if (command === 'report') {
    const report = JSON.parse(readFileSync(join(directory, 'verdict.json'), 'utf8')) as Aggregate;
    console.log(markdown(report));
    if (!report.ok) process.exitCode = 1;
  } else throw new Error('Use ring3.ts prepare|run|report [directory]');
}
