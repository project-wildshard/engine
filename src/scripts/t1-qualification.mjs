#!/usr/bin/env node
// Q4's three-day report window uses actual main-push artifacts, never a
// committed start date or a green report-wrapper exit.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scratchDir } from './.kit/scratch-dir.mjs';
import { T1_SHARDS } from './t1-shards.mjs';

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const SUITES = Object.keys(T1_SHARDS);
/** @typedef {{id:number,name:string,created_at:string,expired:boolean,workflow_run?:{id:number,head_branch:string}}} GithubArtifact */
/** Changing the suite or runner resets qualification; ordinary game changes do not.
 * @param {string} [root] */
export function t1Scope(root = process.cwd()) {
  const files = readdirSync(resolve(root, 'src/e2e/t1')).filter(name => name.endsWith('.ts')).sort().map(name => `src/e2e/t1/${name}`);
  const digest = createHash('sha256');
  for (const file of [...files, 'src/scripts/t1-shards.mjs', 'src/scripts/t1-ci-proof.mjs', 'src/scripts/t1-e2e.mjs', 'src/scripts/t1-runner.mjs']) digest.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0');
  return digest.digest('hex');
}
export const t1ContentReady = () => existsSync('src/e2e/t1/content.spec.ts');
/** Validate one complete hosted push against its Actions metadata.
 * @param {{id:number,sha:string,created:number,event:string,branch:string,receipts:readonly any[]}} run
 * @param {number} now @param {string} scope */
export function qualifiedT1Run(run, now, scope) {
  if (!Number.isSafeInteger(run.id) || !/^[a-f0-9]{40}$/u.test(run.sha) || run.event !== 'push' || run.branch !== 'main'
    || !Number.isFinite(run.created) || run.created > now || run.created < now - 7 * 24 * 60 * 60 * 1000
    || run.receipts.length !== SUITES.length) return false;
  const builds = new Set();
  for (const suite of SUITES) {
    const rows = run.receipts.filter(row => row?.suite === suite);
    if (rows.length !== 1) return false;
    const row = rows[0];
    if (row.scope !== scope || row.complete !== true || row.version !== 1 || row.sha !== run.sha || String(row.run) !== String(run.id) || row.event !== 'push'
      || row.ref !== 'refs/heads/main' || row.platform !== 'linux' || row.status !== 0 || row.signal !== null
      || row.error !== null || row.verdict !== 'pass' || row.budgetMs !== 120_000 || !Number.isFinite(row.wallMs)
      || row.wallMs < 0 || row.wallMs > 120_000 || !Number.isFinite(row.started) || row.started < run.created
      || row.started + row.wallMs > now || row.started - run.created > 24 * 60 * 60 * 1000 || typeof row.build !== 'string') return false;
    const prefix = row.build.split('-')[0];
    if (!/^[a-f0-9]{7,40}$/u.test(prefix) || !run.sha.startsWith(prefix)) return false;
    builds.add(row.build);
  }
  return builds.size === 1;
}
/** @param {Parameters<typeof qualifiedT1Run>[0][]} runs @param {number} now @param {string} scope */
export function t1Qualification(runs, now, scope) {
  const observed = [...new Map(runs.filter(run => Number.isSafeInteger(run.id) && /^[a-f0-9]{40}$/u.test(run.sha)
    && run.event === 'push' && run.branch === 'main' && Number.isFinite(run.created) && run.created <= now
    && run.created >= now - 7 * 24 * 60 * 60 * 1000 && run.receipts.some(row => row?.scope === scope
      && row.complete === true && row.sha === run.sha && String(row.run) === String(run.id) && row.platform === 'linux'))
    .map(run => [run.id, run])).values()];
  const reds = observed.filter(run => !qualifiedT1Run(run, now, scope));
  const lastRed = Math.max(-Infinity, ...reds.map(run => run.created));
  const qualified = observed.filter(run => run.created > lastRed && qualifiedT1Run(run, now, scope))
    .sort((left, right) => left.created - right.created);
  const first = qualified.length === 0 ? null : Math.min(...qualified.map(run => Math.max(...run.receipts.map(row => row.started + row.wallMs))));
  const block = qualified.length >= 3 && first !== null && now - first >= WINDOW_MS;
  return { version: 1, at: now, scope, block, first, redRuns: reds.map(run => run.id), runs: qualified.map(run => run.id), reason: block
    ? 'Three complete hosted main pushes and three report days proved'
    : 'Need three complete hosted main pushes and three report days' };
}

/** A shared build carries the collector's current, suite-matched policy.
 * @param {any} value @param {string} scope @param {number} now */
export function activeT1Gate(value, scope, now) {
  return value?.version === 1 && value.block === true && value.scope === scope
    && Array.isArray(value.runs) && new Set(value.runs).size >= 3
    && Number.isFinite(value.first) && now - value.first >= WINDOW_MS
    && Number.isFinite(value.at) && value.at <= now && now - value.at <= 24 * 60 * 60 * 1000;
}

/** Fetch bounded receipt-only artifacts from Actions. Missing or unreadable
 * evidence keeps reporting. Archives are read in memory, never extracted.
 * @param {NodeJS.ProcessEnv} env @param {number} now */
export async function readT1Qualification(env, now = Date.now()) {
  const scope = t1Scope();
  if (!t1ContentReady()) return { ...t1Qualification([], now, scope), reason: 'A content specs have not arrived' };
  const token = env.GH_TOKEN, repo = env.GITHUB_REPOSITORY;
  if (!token || !repo || !/^[-\w.]+\/[-\w.]+$/u.test(repo)) return { ...t1Qualification([], now, scope), reason: 'No Actions history credentials' };
  const deadline = Date.now() + 60_000;
  /** @param {string} path @param {boolean} [binary] */
  const api = async (path, binary = false) => {
    if (Date.now() >= deadline) throw new Error('T1 history exceeded its one-minute lookup budget');
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now()))),
    });
    if (!response.ok) throw new Error(`Actions history HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  /** @type {GithubArtifact[]} */
  const candidates = [];
  for (let page = 1; page <= 5; page++) {
    const data = await api(`actions/artifacts?name=template-e2e-${SUITES[0]}&per_page=100&page=${page}`);
    if (!Array.isArray(data.artifacts)) throw new Error('Malformed Actions artifact list');
    const artifacts = /** @type {GithubArtifact[]} */ (data.artifacts);
    candidates.push(...artifacts.filter(row => !row.expired && row.workflow_run?.head_branch === 'main'));
    if (data.artifacts.length < 100) break;
  }
  // Read every receipt in the report window, plus its preceding anchor.
  // The lookup deadline keeps incomplete history advisory.
  candidates.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const mature = candidates.filter(row => Date.parse(row.created_at) <= now - WINDOW_MS
    && Date.parse(row.created_at) >= now - 7 * 24 * 60 * 60 * 1000).slice(0, 1);
  const selected = [...new Map([...mature, ...candidates.filter(row => Date.parse(row.created_at) > now - WINDOW_MS)].map(row => [row.id, row])).values()]
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  const runs = [];
  for (const candidate of selected) {
    if (candidate.workflow_run === undefined) continue;
    const id = candidate.workflow_run.id;
    const run = await api(`actions/runs/${id}`);
    if (run.status !== 'completed' || run.event !== 'push' || run.head_branch !== 'main'
      || run.path !== '.github/workflows/ci.yml' || run.head_repository?.full_name !== repo) continue;
    const data = await api(`actions/runs/${id}/artifacts?per_page=100`);
    if (!Array.isArray(data.artifacts)) throw new Error('Malformed run artifact list');
    const available = /** @type {GithubArtifact[]} */ (data.artifacts);
    const receipts = [];
    for (const suite of SUITES) {
      const artifacts = available.filter(row => row.name === `template-e2e-${suite}` && !row.expired);
      if (artifacts.length !== 1) continue;
      const archive = await api(`actions/artifacts/${artifacts[0].id}/zip`, true);
      if (archive.length > 1_000_000) throw new Error('T1 receipt archive exceeds its size bound');
      const decoded = spawnSync('python3', ['-c',
        'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); names=z.namelist(); assert len(names)==1; i=z.getinfo(names[0]); assert i.file_size<20000; sys.stdout.buffer.write(z.read(i))'],
        { input: archive, encoding: 'utf8', maxBuffer: 20_000 });
      if (decoded.status !== 0) throw new Error('Unreadable T1 receipt archive');
      receipts.push(JSON.parse(decoded.stdout));
    }
    runs.push({ id, sha: run.head_sha, created: Date.parse(run.created_at), event: run.event, branch: run.head_branch, receipts });
  }
  return t1Qualification(runs, now, scope);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const now = Date.now(), scope = t1Scope();
  let result;
  try { result = await readT1Qualification(process.env, now); }
  catch (error) { result = { ...t1Qualification([], now, scope), reason: error instanceof Error ? error.message : 'History unavailable' }; }
  const lane = process.env.WS_LANE_NAME ?? 'template-e2e-ci';
  const scratch = scratchDir(lane, 'Template qualification evidence', { env: { ...process.env, WS_LANE_NAME: lane } });
  writeFileSync(resolve(scratch, 'qualification.json'), `${JSON.stringify(result)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `blocking=${String(result.block)}\n`);
  console.log(`T1 qualification: ${result.block ? 'blocking' : 'report-only'}; ${result.reason}; ${result.runs.length} complete pushes`);
}
