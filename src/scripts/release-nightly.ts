// TC22/J370: new nightly failures hold the real release path. J167's
// any-red qualification remains a separate manual check until a green night.
import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DISPATCH, STALE_MS, hours, isReleaseNightly, type NightlyRun} from './nightly-keeper.ts';

type Latest = NightlyRun & {conclusion: string};
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

// Meta QA 11-25 row 142: the verdict must be fresh and on the tag's line. A nightly over STALE_MS old holds the tag,
// and so does one whose head the tag neither contains nor extends by release stamps only (`chore(release): v…`):
// that nightly judged a tree the tag does not carry. Judging the tag's own commit would put the nightly's 80 minutes
// into every train (J505), so a nightly before the cut, which the tag contains, still qualifies within 26 h.
// ALLOW_STALE_NIGHTLY=1 (J381) prints the refusal and lets the tag through.
export function requireFresh(latest: Pick<NightlyRun, 'id' | 'created_at'>, now: number): void {
  const at = Date.parse(latest.created_at ?? '');
  if (!Number.isFinite(at)) throw new Error(`TC22: nightly ${latest.id} has no start time; release held`);
  if (now - at > STALE_MS)
    throw new Error(`TC22: newest release nightly ${latest.id} started ${hours(now - at)} h ago, over ${hours(STALE_MS)} h; release held. Dispatch one on main: ${DISPATCH}`);
}

// v0.1.96 and v0.1.97 tags (opus-rel86, opus-rel97): a red nightly whose new failures a later main commit fixes held the
// tag, and the only way past was --no-verify, which also skipped the changelog, AGENTS.md, format and pin checks.
// ALLOW_NIGHTLY_FAILURES=<sha>[,<sha>] (J381) names the fixing commits. Each must be on origin/main, descend from the
// nightly's head and name the nightly's run id in its message. The tag passes only when every new failure is named by a
// fix's message or a path it touches: a head phase by its phase word (boot, hover, draw, explorer, cook), a runner job by
// its job word, anything else by its whole key. One failure outside that set still holds the tag, so the hatch cannot
// wave a new red through. A missing, mismatched or malformed verdict still holds.
export interface FixCommit {sha: string; message: string; files: string[]}

/** The new failures no fixing commit names. */
export function uncoveredFailures(keys: readonly string[], fixes: readonly FixCommit[]): string[] {
  const text = fixes.map(fix => `${fix.message}\n${fix.files.join('\n')}`).join('\n').toLowerCase();
  const named = (word: string) =>
    new RegExp(`(^|[^a-z0-9])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}($|[^a-z0-9])`, 'u').test(text);
  return keys.filter(key => {
    if (named(key)) return false;
    const head = /^(?:chromium|webkit)\/[^/]+@[^/]+\/([a-z]+)$/u.exec(key);
    if (head?.[1] !== undefined) return !named(head[1]);
    const runner = /^runner\/([a-z0-9-]+)$/u.exec(key);
    if (runner?.[1] !== undefined) return !named(runner[1]);
    return true;
  });
}

/** A fixing commit, refused unless it is on origin/main, descends from the nightly's head and names the nightly's run. */
export function readFix(ref: string, latest: Pick<NightlyRun, 'id' | 'head_sha'>, git: Git): FixCommit {
  if (!/^[0-9a-f]{7,40}$/u.test(ref)) throw new Error(`TC22: ALLOW_NIGHTLY_FAILURES takes fixing commit SHAs, not ${JSON.stringify(ref)}; release held`);
  try {git('cat-file', '-e', `${ref}^{commit}`);} catch {
    try {git('fetch', '--quiet', 'origin', ref);} catch {/* judged below */}
  }
  let sha: string;
  try {sha = git('rev-parse', '--verify', `${ref}^{commit}`).trim();} catch {
    throw new Error(`TC22: fixing commit ${ref} is not in this clone; release held`);
  }
  try {git('merge-base', '--is-ancestor', latest.head_sha, sha);} catch {
    throw new Error(`TC22: fixing commit ${ref} does not descend from nightly ${latest.id}'s head ${latest.head_sha.slice(0, 10)}; release held`);
  }
  let main = '';
  try {main = git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main').trim();} catch {/* no origin/main: a fixture */}
  if (main !== '') {
    try {git('merge-base', '--is-ancestor', sha, main);} catch {throw new Error(`TC22: fixing commit ${ref} is not on origin/main; release held`);}
  }
  const message = git('log', '-1', '--format=%B', sha);
  if (!new RegExp(`(^|\\D)${latest.id}(\\D|$)`, 'u').test(message))
    throw new Error(`TC22: fixing commit ${ref} does not name nightly ${latest.id}; release held`);
  return {sha, message, files: git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n').filter(Boolean)};
}

export function allowFailures(judge: () => string[], keys: () => readonly string[], latest: Pick<NightlyRun, 'id' | 'head_sha'>,
  git: Git, env: NodeJS.ProcessEnv = process.env): string[] {
  try {return judge();} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refs = (env.ALLOW_NIGHTLY_FAILURES ?? '').split(',').map(ref => ref.trim()).filter(Boolean);
    if (refs.length === 0 || !message.startsWith('TC22: new nightly failures')) throw error;
    const fixes = refs.map(ref => readFix(ref, latest, git)), failing = keys(), left = uncoveredFailures(failing, fixes);
    if (left.length > 0)
      throw new Error(`TC22: ALLOW_NIGHTLY_FAILURES=${refs.join(',')} names no fix for ${left.length} of ${failing.length} new failures; release held: ${left.slice(0, 20).join(', ')}`);
    console.log(`TC22: ALLOW_NIGHTLY_FAILURES=${refs.join(',')} (J381): all ${failing.length} new failures named by ${fixes.map(fix => fix.sha.slice(0, 10)).join(', ')}; letting through`);
    return [];
  }
}

export type Git = (...args: string[]) => string;

/** Commits the tag carries past the nightly's head, or an error when the nightly is off the tag's line. */
export function requireCovers(latest: Pick<NightlyRun, 'id' | 'head_sha'>, tag: string, git: Git): number {
  try {git('cat-file', '-e', `${latest.head_sha}^{commit}`);} catch {
    try {git('fetch', '--quiet', 'origin', latest.head_sha);} catch {/* judged below */}
  }
  let base: string;
  try {base = git('merge-base', tag, latest.head_sha).trim();} catch {
    throw new Error(`TC22: nightly ${latest.id}'s head ${latest.head_sha.slice(0, 10)} is not in this clone; release held`);
  }
  const past = git('log', '--format=%s', `${base}..${tag}`).split('\n').filter(Boolean);
  if (base === latest.head_sha) return past.length;
  if (past.every(subject => /^chore\(release\): v\d+\.\d+\.\d+\b/u.test(subject))) return 0;
  throw new Error(`TC22: nightly ${latest.id} (${latest.head_sha.slice(0, 10)}) is off the tag's line: the tag carries ${past.length} commits past their fork that are not release stamps; release held`);
}

function judgeLine(latest: Latest, tag: string, now: number): void {
  const git: Git = (...args) => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000});
  try {
    requireFresh(latest, now);
    const past = requireCovers(latest, tag, git);
    console.log(`TC22: nightly ${latest.id} started ${hours(now - Date.parse(latest.created_at ?? ''))} h ago and covers the tag`
      + (past > 0 ? ` (the tag carries ${past} commits past its head)` : ''));
  } catch (error) {
    if (process.env.ALLOW_STALE_NIGHTLY !== '1') throw error;
    console.log(`TC22: ALLOW_STALE_NIGHTLY=1 (J381), letting through: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function checkReleaseNightly(tag = 'HEAD', now = Date.now()): void {
  const runs = JSON.parse(execFileSync('gh', ['api',
    'repos/project-wildshard/engine/actions/workflows/nightly.yml/runs?branch=main&status=completed&per_page=100',
    '--jq', '.workflow_runs | map({id, head_sha, status, conclusion, event, display_title, created_at})',
  ], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024})) as (Latest | null)[];
  // Diagnostics and staging dispatches cannot replace the current production proof.
  const latest = runs.find(isReleaseNightly);
  if (latest === undefined || latest === null || !Number.isSafeInteger(latest.id) || latest.id < 1)
    throw new Error('TC22: no completed hosted nightly; release held');
  judgeLine(latest, tag, now);
  const parent = resolve('tmp/release-nightly');
  mkdirSync(parent, {recursive: true});
  const folder = mkdtempSync(join(parent, 'verdict-'));
  try {
    execFileSync('gh', ['run', 'download', String(latest.id), '--repo', 'project-wildshard/engine',
      '--name', 'nightly-verdict', '--dir', folder], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024});
    const value: unknown = JSON.parse(readFileSync(join(folder, 'verdict.json'), 'utf8'));
    const git: Git = (...args) => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000});
    const faults = allowFailures(() => requireNoNewFailures(value, latest), () => (value as Report).newFailures, latest, git);
    if (faults.length > 0) logRunnerFault(latest.id, faults);
    else console.log(`TC22: nightly ${latest.id} has no new failures; J167 any-red qualification still requires the manual check`);
  } finally {rmSync(folder, {recursive: true, force: true});}
}

/** The commit of the first version tag a push creates or moves, or null when the push carries none. */
export function releaseTagCommit(refs: string): string | null {
  for (const line of refs.split('\n')) {
    const [, local = '', remote = ''] = line.trim().split(/\s+/u);
    if (/^[a-f0-9]{40}$/u.test(local) && !/^0+$/u.test(local) && /^refs\/tags\/v\d+\.\d+\.\d+$/u.test(remote)) return `${local}^{commit}`;
  }
  return null;
}

export function releaseTagPush(refs: string): boolean {
  return releaseTagCommit(refs) !== null;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== 'refs') throw new Error('Use release-nightly.ts refs (Git push ref lines on stdin)');
  const tag = releaseTagCommit(readFileSync(0, 'utf8'));
  if (tag !== null) checkReleaseNightly(tag);
}
