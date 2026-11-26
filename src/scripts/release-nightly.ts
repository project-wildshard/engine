// TC22/J370: new nightly failures hold the real release path. J167's
// any-red qualification remains a separate manual check until a green night.
import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

interface Latest {id: number; head_sha: string; status: string; conclusion: string; event: string; display_title?: string}
interface Report {version: number; run: string; sha: string; pins: string; testList: string;
  failures: {key: string; error?: string}[]; newFailures: string[]}

// QA 11-24 row 66: a nightly that failed only because the runner did (an abandoned or cancelled Actions job,
// a lost WebGL context on the paravirtual GPU, and the phases that then wrote no receipt) is not a code red.
// It lets the tag through with a named receipt; any other new failure still holds it.
const CONTEXT_LOST = /WebGL context lost|CONTEXT_LOST_WEBGL/u;
const RUNNER_JOB = /^Actions job (abandoned|cancelled)\b/u;
const AFTERMATH = /^Expected one receipt, got 0$|Execution context was destroyed/u;

export function runnerFaults(report: Pick<Report, 'failures' | 'newFailures'>): string[] | null {
  if (report.newFailures.length === 0) return null;
  const errorOf = (key: string) => report.failures.find(row => row.key === key)?.error ?? '';
  const runnerJob = report.failures.some(row => row.key.startsWith('runner/') && RUNNER_JOB.test(row.error ?? ''));
  const lostHeads = new Set(report.failures.filter(row => CONTEXT_LOST.test(row.error ?? ''))
    .map(row => row.key.slice(0, row.key.lastIndexOf('/'))));
  const fault = (key: string) => {
    const error = errorOf(key);
    if (CONTEXT_LOST.test(error)) return true;
    return AFTERMATH.test(error) && (runnerJob || lostHeads.has(key.slice(0, key.lastIndexOf('/'))));
  };
  return report.newFailures.every(fault) ? [...report.newFailures] : null;
}

function receiptPath(): string {
  return process.env.TC22_RECEIPTS ?? join(homedir(), '.cache/wildshard/lane-receipts.log');
}

function logRunnerFault(id: number, keys: string[]): void {
  const now = new Date(), hh = String(now.getUTCHours()).padStart(2, '0'), mm = String(now.getUTCMinutes()).padStart(2, '0');
  const line = `${hh}:${mm} UTC tc22 NOTE nightly ${id} red from runner faults only (${keys.length} keys: job abandoned, context lost, 0 receipts); tag let through`;
  console.log(`TC22: ${line.slice(line.indexOf('nightly'))}: ${keys.join(', ')}`);
  const file = receiptPath();
  if (existsSync(dirname(file))) appendFileSync(file, `${line}\n`);
}

function isReleaseNightly(run: Latest | null): boolean {
  return run?.event === 'schedule' || (run?.event === 'workflow_dispatch' && run.display_title === 'nightly release proof');
}

export function requireNoNewFailures(value: unknown, latest: Latest): string[] {
  const report = value as Partial<Report> | null;
  if (report === null || typeof report !== 'object' || report.version !== 2 ||
    !Number.isSafeInteger(latest.id) || latest.id < 1 || latest.status !== 'completed' || !isReleaseNightly(latest) ||
    !['success', 'failure'].includes(latest.conclusion) || !/^[a-f0-9]{40}$/u.test(latest.head_sha) ||
    report.run !== String(latest.id) || report.sha !== latest.head_sha ||
    typeof report.pins !== 'string' || !/^[a-f0-9]{64}$/u.test(report.pins) ||
    typeof report.testList !== 'string' || !/^[a-f0-9]{64}$/u.test(report.testList) ||
    !Array.isArray(report.failures) || report.failures.some(row => row === null || typeof row !== 'object' || typeof row.key !== 'string' ||
      (row.error !== undefined && typeof row.error !== 'string')) ||
    !Array.isArray(report.newFailures) || report.newFailures.some(key => typeof key !== 'string' || key.length === 0 || !report.failures?.some(row => row.key === key))) {
    throw new Error('TC22: latest completed hosted nightly verdict is missing, incomplete or mismatched; release held');
  }
  if (report.newFailures.length === 0) return [];
  const faults = runnerFaults(report as Report);
  if (faults === null) throw new Error(`TC22: new nightly failures; release held: ${report.newFailures.join(', ')}`);
  return faults;
}

export function checkReleaseNightly(): void {
  const runs = JSON.parse(execFileSync('gh', ['api',
    'repos/project-wildshard/engine/actions/workflows/nightly.yml/runs?branch=main&status=completed&per_page=100',
    '--jq', '.workflow_runs | map({id, head_sha, status, conclusion, event, display_title})',
  ], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024})) as (Latest | null)[];
  // Diagnostics and staging dispatches cannot replace the current production proof.
  const latest = runs.find(isReleaseNightly);
  if (latest === undefined || latest === null || !Number.isSafeInteger(latest.id) || latest.id < 1)
    throw new Error('TC22: no completed hosted nightly; release held');
  const parent = resolve('tmp/release-nightly');
  mkdirSync(parent, {recursive: true});
  const folder = mkdtempSync(join(parent, 'verdict-'));
  try {
    execFileSync('gh', ['run', 'download', String(latest.id), '--repo', 'project-wildshard/engine',
      '--name', 'nightly-verdict', '--dir', folder], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024});
    const faults = requireNoNewFailures(JSON.parse(readFileSync(join(folder, 'verdict.json'), 'utf8')), latest);
    if (faults.length > 0) logRunnerFault(latest.id, faults);
    else console.log(`TC22: nightly ${latest.id} has no new failures; J167 any-red qualification still requires the manual check`);
  } finally {rmSync(folder, {recursive: true, force: true});}
}

export function releaseTagPush(refs: string): boolean {
  return refs.split('\n').some(line => {
    const [, local = '', remote = ''] = line.trim().split(/\s+/u);
    return /^[a-f0-9]{40}$/u.test(local) && !/^0+$/u.test(local) && /^refs\/tags\/v\d+\.\d+\.\d+$/u.test(remote);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== 'refs') throw new Error('Use release-nightly.ts refs (Git push ref lines on stdin)');
  if (releaseTagPush(readFileSync(0, 'utf8'))) checkReleaseNightly();
}
