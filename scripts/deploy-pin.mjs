#!/usr/bin/env node
// deploy-pin.mjs — what production and the native OTA channel serve (GAME-NORMALIZATION F3.1, plan spec 03 §13;
// decision 32). `.github/deploy-pin.json` holds the pin; deploy.yml and ota-promote.yml read it with `read`.
//
//   node scripts/deploy-pin.mjs read                                  # prints the SHA; sha= mode= gate= to $GITHUB_OUTPUT
//   node scripts/deploy-pin.mjs check-gate <sha>                      # exit 0 only if <sha> has gpu-gate = success
//   node scripts/deploy-pin.mjs release-ready                         # ready=, sha= to $GITHUB_OUTPUT; no wait
//   node scripts/deploy-pin.mjs check-live-floor <sha>                # automatic releases never move behind production
//   node scripts/deploy-pin.mjs set <sha> --milestone M<n> --go "<where Jake OKed>"
//   node scripts/deploy-pin.mjs rollback <sha> --go "<Jake's words>"   # any SHA proven previously live in production
//   node scripts/deploy-pin.mjs mode newest-green --go "<…>"          # Z4 only
//   node scripts/deploy-pin.mjs mode newest-ci-green --go "<…>"       # the newest main whose push CI (deploy.yml) passed
//
// `set` refuses unless the SHA is on origin/main, its gpu-gate is green, its pending.json is empty, no shard was only
// bootstrap-recorded there, and it (or a runtime-equal ancestor) has a gpu-perf/memory success (R1-13, R2-27, R2-28,
// R4-15). It only writes the file: the lead commits `.github/deploy-pin.json` alone, pushes, and runs
// `gh workflow run deploy`.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILE = '.github/deploy-pin.json';
const REPO = 'project-wildshard/engine';
const PENDING = 'project/archive/game-normalization/reviews/pending.json';
/** What a build is made of (03 §1's export, without test/parity/): a diff outside these is not a runtime change. */
const RUNTIME = ['src', 'public', 'api', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'vercel.json'];

/** @param {...string} args */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** @param {() => unknown} fn */
const ok = (fn) => { try { fn(); return true; } catch { return false; } };

/** `gh api …`, retried: one GitHub 5xx (HTTP 503 "No server is currently available", 2026-10-03 run 37157015487) failed
 *  a whole release at this step. Four tries, 5 / 15 / 45 s apart. @param {string[]} args @returns {string} */
function ghApi(args) {
  // gh forbids --slurp with --jq. Keep the complete page array and apply
  // the same trusted filter afterward; filtering errors are not API retries.
  const jqAt = args.includes('--slurp') ? args.indexOf('--jq') : -1;
  const filter = jqAt < 0 ? undefined : args[jqAt + 1];
  if (jqAt >= 0 && filter === undefined) throw new Error('Missing paginated API filter');
  const apiArgs = jqAt < 0 ? args : args.filter((_arg, index) => index !== jqAt && index !== jqAt + 1);
  let response;
  for (let i = 0; ; i++) {
    try {
      response = execFileSync('gh', ['api', '-H', 'Cache-Control: no-cache', ...apiArgs], { encoding: 'utf8' });
      break;
    } catch (e) {
      if (i === 3) throw e;
      console.error(`gh api ${args[0]}: try ${i + 1} failed, retrying`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * 3 ** i);
    }
  }
  return filter === undefined ? response
    : execFileSync('jq', ['-r', filter], { input: response, encoding: 'utf8' });
}

/** @type {WeakMap<(args:string[])=>string, Map<string, string>>} */
const workflowIds = new WeakMap();

/** Resolve workflow paths once per API client; filename-based run queries can return empty results.
 * @param {'deploy.yml' | 'boot-smoke.yml'} workflow @param {(args:string[])=>string} [query] */
export function workflowRunsPath(workflow, query = ghApi) {
  let ids = workflowIds.get(query);
  if (ids === undefined) {
    ids = new Map();
    const rows = query([`repos/${REPO}/actions/workflows?per_page=100&page=1`, '--paginate', '--jq',
      '.workflows[] | [.path, .id] | @tsv']).trim().split('\n').filter(Boolean);
    for (const row of rows) {
      const [path = '', id = ''] = row.split('\t');
      if (path !== '.github/workflows/deploy.yml' && path !== '.github/workflows/boot-smoke.yml') continue;
      if (!/^\d+$/.test(id) || ids.has(path)) throw new Error(`Invalid workflow identity: ${row}`);
      ids.set(path, id);
    }
    workflowIds.set(query, ids);
  }
  const id = ids.get(`.github/workflows/${workflow}`);
  if (id === undefined) throw new Error(`Missing workflow: ${workflow}`);
  return `repos/${REPO}/actions/workflows/${id}/runs`;
}

/** @typedef {{ mode: string, sha: string, milestone: string, gate: string, go: string, set: string, by: string, ciRun?: string }} Pin */

/** @param {Pin} pin @returns {Pin} */
export function validatePin(pin) {
  if (!/^[0-9a-f]{40}$/.test(pin.sha)) throw new Error(`${FILE}: sha must be 40 hex`);
  if (!['pinned', 'newest-green', 'newest-ci-green'].includes(pin.mode)) throw new Error(`${FILE}: mode must be pinned | newest-green | newest-ci-green`);
  if (!['grandfathered', 'required'].includes(pin.gate)) throw new Error(`${FILE}: gate must be grandfathered | required`);
  if (pin.ciRun !== undefined && !/^\d+$/.test(pin.ciRun)) throw new Error(`${FILE}: ciRun must be a numeric workflow run`);
  return pin;
}

/** @returns {Pin} */
const readPin = () => validatePin(JSON.parse(readFileSync(FILE, 'utf8')));
/** @param {Pin} pin */
const writePin = (pin) => writeFileSync(FILE, `${JSON.stringify(validatePin(pin), null, 2)}\n`);

/** @param {string} sha @param {(args:string[])=>string} [query] @returns {Map<string, { state: string, description: string, createdAt: string }>} */
function statuses(sha, query = ghApi) {
  const out = query([`repos/${REPO}/commits/${sha}/status`, '--paginate', '--jq', '.statuses[] | [.context, .state, .description, .created_at] | @tsv']);
  const seen = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    const [context, state, description = '', createdAt = ''] = line.split('\t');
    if (!seen.has(context)) seen.set(context, { state, description, createdAt }); // newest first
  }
  return seen;
}

/** @param {string} sha */
export function gateGreen(sha) {
  return statuses(sha).get('gpu-gate')?.state === 'success';
}

/** An exact SHA must have a successful real built-dist boot. A later pending/failing run overrides an older success.
 * @param {string} sha @param {(args:string[])=>string} [query] */
export function bootGreen(sha, query = ghApi) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('boot-smoke requires an exact 40-hex SHA');
  return statuses(sha, query).get('boot-smoke')?.state === 'success';
}

/** Automatic releases may keep or advance production, never replace it with an older or divergent tree.
 * Resolve the live build's commit-typed SHA through GitHub's immutable
 * comparison; a tree/blob sharing its prefix is not a production commit.
 * @param {string} build @param {string} candidate @param {(args:string[])=>string} [query] @returns {string} */
export function productionFloor(build, candidate, query = ghApi) {
  const short = build.split('-')[0] ?? '';
  if (!/^[0-9a-f]{7,40}$/.test(short) || !/^[0-9a-f]{40}$/.test(candidate)) throw new Error('Invalid production floor identity');
  const comparison = JSON.parse(query([`repos/${REPO}/compare/${short}~0...${candidate}`, '--jq', '{status,base_commit:{sha:.base_commit.sha}}']));
  const live = comparison.base_commit?.sha;
  if (typeof live !== 'string' || !/^[0-9a-f]{40}$/.test(live) || !live.startsWith(short)) throw new Error('Unreadable production floor comparison');
  if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
    throw new Error(`release refused: ${candidate} does not advance production ${live} (${comparison.status})`);
  }
  return live;
}

/** Historical successful release logs bind the full pin to a matching version actually read from production.
 * A pin history entry, a deployment attempt, or a neighbouring short SHA alone is not proof of shipping.
 * @param {string} sha @param {string} log */
export function logProvesProduction(sha, log) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  const pins = new Set([...log.matchAll(/\bDEPLOY_SHA: ([0-9a-f]{40})\b/g)].map(match => match[1]));
  if (pins.size !== 1 || !pins.has(sha)) return false;
  return [...log.matchAll(/\bProduction ([0-9a-f]{7,40})-[^\s;]+; target ([0-9a-f]{7,40}); match true\b/g)]
    .some(match => sha.startsWith(match[1]) && sha.startsWith(match[2]));
}

/** Emergency rollback proof, including releases older than the boot workflow. New releases record a durable
 * exact-SHA status after verification; older releases are verified against successful release-job logs.
 * @param {string} sha @param {(args:string[])=>string} [query] */
export function productionLive(sha, query = ghApi) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('production proof requires an exact 40-hex SHA');
  if (statuses(sha, query).get('production-live')?.state === 'success') return true;
  for (const event of ['schedule', 'workflow_dispatch']) {
    for (let page = 1; ; page++) {
      const runs = query([`${workflowRunsPath('deploy.yml', query)}?event=${event}&status=success&per_page=100&page=${page}`,
        '--jq', '.workflow_runs[].id']).trim().split('\n').filter(Boolean);
      if (runs.length === 0) break;
      for (const run of runs) {
        if (!/^\d+$/.test(run)) throw new Error('Invalid release workflow run identity');
        const jobs = query([`repos/${REPO}/actions/runs/${run}/jobs`, '--paginate', '--jq',
          '.jobs[] | select(.name == "build-and-deploy" and .conclusion == "success") | .id']).trim().split('\n').filter(Boolean);
        for (const job of jobs) {
          if (!/^\d+$/.test(job)) throw new Error('Invalid release job identity');
          let log;
          try { log = query([`repos/${REPO}/actions/jobs/${job}/logs`]); } catch { continue; /* Expired logs cannot prove a release. */ }
          if (logProvesProduction(sha, log)) return true;
        }
      }
      if (runs.length < 100) break;
    }
  }
  return false;
}

/** Reuse only a completed successful main push workflow for this exact commit, never a release or neighbour SHA.
 * @param {string} sha @param {(args:string[])=>string} [query] @returns {boolean} */
export function ciGreen(sha, query = ghApi) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('push CI requires an exact 40-hex SHA');
  const runs = query([`${workflowRunsPath('deploy.yml', query)}?branch=main&event=push&status=success&head_sha=${sha}&per_page=1&page=1`,
    '--jq', '.workflow_runs[].head_sha']).trim().split('\n');
  return runs.includes(sha);
}

/** Exact successful producer identity for the prebuilt release artifact.
 * @param {string} sha @param {(args:string[])=>string} [query] @returns {string} */
export function ciSourceRun(sha, query = ghApi) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Prebuilt producer requires an exact SHA');
  const data = JSON.parse(query([`${workflowRunsPath('deploy.yml', query)}?branch=main&event=push&status=success&head_sha=${sha}&per_page=1&page=1`]));
  const run = data.workflow_runs?.[0];
  if (run?.head_sha !== sha || run.event !== 'push' || run.head_branch !== 'main'
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== '.github/workflows/deploy.yml' || run.head_repository?.full_name !== REPO
    || !/^\d+$/.test(String(run.id))) throw new Error('No exact successful prebuilt producer');
  return String(run.id);
}

/** Explicit operator-selected CI proof for the legacy 16-job pipeline. GitHub can leave its aggregate
 * running after every required job has completed. No missing, skipped or extra job supplies this proof.
 * @param {string} sha @param {string} runId @param {(args:string[])=>string} [query] @returns {boolean} */
export function ciRunGreen(sha, runId, query = ghApi) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^\d+$/.test(runId)) throw new Error('Explicit CI proof requires an exact SHA and numeric run');
  /** @type {{id:number,workflow_id:number,event:string,head_branch:string,head_sha:string,path:string,status:string,conclusion:string|null,head_repository?:{full_name:string}}} */
  const run = JSON.parse(query([`repos/${REPO}/actions/runs/${runId}`]));
  const workflowId = workflowRunsPath('deploy.yml', query).split('/').at(-2);
  if (String(run.id) !== runId || String(run.workflow_id) !== workflowId || run.event !== 'push'
    || run.head_branch !== 'main' || run.head_sha !== sha || run.path !== '.github/workflows/deploy.yml'
    || run.head_repository?.full_name !== REPO) return false;
  if (run.status === 'completed' && run.conclusion === 'success') return true;
  if (run.status !== 'in_progress' || run.conclusion !== null) return false;
  const required = new Set(['products', 'build-and-deploy',
    ...Array.from({length:4}, (_, i) => `typecheck-lint (${i+1})`),
    ...Array.from({length:10}, (_, i) => `behaviour (${i+1})`)]);
  const rows = query([`repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`, '--paginate', '--jq',
    '.jobs[] | [.name, .status, .conclusion] | @tsv']).trim().split('\n').filter(Boolean);
  if (rows.length !== required.size) return false;
  for (const row of rows) {
    const [name = '', status, conclusion] = row.split('\t');
    if (!required.delete(name) || status !== 'completed' || conclusion !== 'success') return false;
  }
  return required.size === 0;
}

/** Explicit recovery of proven source after shipping failed. Only the original
 * source gates may grant proof; the failed aggregate never becomes CI success.
 * @param {string} runId @param {(args:string[])=>string} [query]
 * @returns {{sha:string,run:string}} */
export function recoverySource(runId, query = ghApi) {
  const {sha,run} = recoveryEvidence(runId, query, false);
  return {sha,run};
}

/** G917 is an explicit deadline decision, never an automatic green verdict.
 * All jobs must finish; prepare, SIX and latest same-run boot remain green.
 * @param {string} runId @param {(args:string[])=>string} [query] @param {number} [now] */
export function deadlineRecoverySource(runId, query = ghApi, now = Date.now()) {
  if (!Number.isFinite(now) || now < Date.parse('2026-10-30T10:30:00Z'))
    throw new Error('G917 deadline recovery is unavailable before 2026-10-30T10:30:00Z');
  const selected = recoveryEvidence(runId, query, true);
  const green = JSON.parse(query([`${workflowRunsPath('deploy.yml', query)}?branch=main&event=push&status=success&per_page=1&page=1`,
    '--jq','{workflow_runs:[.workflow_runs[]|{id,head_sha,event,head_branch,status,conclusion,path,head_repository:{full_name:.head_repository.full_name}}]}']));
  if (!Array.isArray(green.workflow_runs) || green.workflow_runs.length > 1)
    throw new Error('Invalid latest green main inventory');
  const latest = green.workflow_runs[0];
  if (latest !== undefined) {
    if (!/^[1-9][0-9]*$/u.test(String(latest.id)) || !/^[a-f0-9]{40}$/u.test(latest.head_sha)
      || latest.event !== 'push' || latest.head_branch !== 'main' || latest.status !== 'completed'
      || latest.conclusion !== 'success' || latest.path !== '.github/workflows/deploy.yml'
      || latest.head_repository?.full_name !== REPO) throw new Error('Invalid latest green main proof');
    if (BigInt(latest.id) >= BigInt(runId)) throw new Error('Use the newer fully green main release instead of G917');
  }
  return selected;
}

class SourceGateError extends Error { name = 'SourceGateError'; }

/** @typedef {{name:string,status:string,conclusion:string|null,number?:number}} SourceStep */
/** @typedef {{name:string,status:string,conclusion:string|null,created_at:string|null,started_at:string|null,completed_at:string|null,
 * run_id?:number,run_attempt?:number,head_sha?:string,steps?:SourceStep[]}} SourceJob */

/** The required native input publisher is a distinct reviewed source shape.
 * Historical sources keep their optional fixture policy unchanged. @param {string} source */
function nativeFixtureSource(source) {
  const native = /\n {2}native-escape:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1] ?? '';
  const fixtures = /\n {2}fixtures:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1] ?? '';
  if (!native.includes('NATIVE_INPUT_PROOF:')) {
    if (native.includes('ci-native-fixtures.mjs') || /^ {4}needs:.*fixtures/mu.test(native))
      throw new Error('Source native fixture policy lacks authority');
    return false;
  }
  const hash = createHash('sha256').update(native).update('\0').update(fixtures).digest('hex');
  if (/^ {6}NATIVE_INPUT_PROOF: 'cache-v1'$/mu.test(native)
    && hash === 'bca0fd2e164ba1412ccc5195d8e46e574f9cfeba352bae768e314828da69af86') return 'v1';
  const behaviour = /\n {2}behaviour:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1] ?? '';
  const all = createHash('sha256').update(native).update('\0').update(fixtures).update('\0').update(behaviour).digest('hex');
  if (/^ {6}NATIVE_INPUT_PROOF: 'cache-v2'$/mu.test(native) && all === 'b1c6b6b881cad24467ed7524e1c1817a9d455b5e6ba3295279a152f149ab8b4e') return 'v2';
  if (/^ {6}NATIVE_INPUT_PROOF: 'cache-v3'$/mu.test(native) && all === '106425c7fd56d11ea2abb1a2d28ed75913506f57bdb4ed5e7b802f4976884458') return 'v3';
  // G872: exact native-routes physics allocation; publisher/admission blocks stay unchanged.
  // The third hash adds only the org token step before each install (P1-shardfile-switch).
  // The fourth adds only the fixture admission's reread of an unsettled prepare (fbf3c6b529).
  // The fifth rewords that reread's comment: prepare lost its job-level group (G609).
  // The sixth pins pnpm 10.34.9 and keys the basis tool on its sharddev path (e4480d9bc9, a6f149e8df).
  // The seventh gives native-escape 30 minutes: a slow runner doubles the chapter's 11 (J112).
  // The eighth publishes behaviour's native witness manifests, to measure what Linux can compare.
  if (/^ {6}NATIVE_INPUT_PROOF: 'cache-v4'$/mu.test(native)
    && (all === 'ce4897403277862407dd752126c4aaecd4062d4a53da69d6fe8ea24f1548c5a0'
      || all === '75299cab0df223a7b41cb574e034c90b4b0f1b7679fda2fda23fede1e528b4ae'
      || all === '7bb051f9b2c0677b84b79bfb4cd92e8e5f019eb83d12cab31e794b8568d90d1d'
      || all === '1d1072918c1a8486d8920d66f824db73ff963c7a033b0cde190b86da812ad25e'
      || all === '7ad88f5f084b0bc7e1e5f6fb2a205f2315346ff238ed114ebf5767d01863896e'
      || all === 'e1a87f9faaaae6f18747503d617074e91bc2a5cc286760f8dd10ba3cbe18d969'
      || all === 'd7576d9a4a50580c18744525ca4ed47d3e1f92dfbf0e084497eb883daec8c415'
      || all === 'a52793d87b004d328b86aff9c348794bf3dd05c1911d825034285b32243f470e')) return 'v4';
  throw new Error('Source native fixture publisher topology differs');
}

/** The optional stage cannot replace any gate or authorize historical sources.
 * @param {string} source */
function stagedBootSource(source) {
  const ship = /\n {2}build-and-deploy:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1] ?? '';
  const stage = /\n {2}stage-prebuilt:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  const marked = /^ {6}STAGED_RELEASE_PROOF: 'v1'$/mu.test(ship);
  if (!marked && stage === undefined) return false;
  const native = /\n {2}native-escape:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  const groups = /^\s+group: \[([^\]]+)\]/mu.exec(native ?? '')?.[1]?.split(',').map(name => name.trim());
  const reviewed = new Set(['escape-titan','stories-qara','chapter-one','native-routes']);
  const behaviour = /\n {2}behaviour:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  const matrix = /^\s+shard: \[([\d, ]+)\]/mu.exec(behaviour ?? '')?.[1]?.split(',').map(Number);
  const packed = /^ {6}BEHAVIOUR_PROOF: 'twelve-g989'$/mu.test(ship);
  const shards = packed ? 12 : 24;
  if (!marked || stage === undefined
    || (/BEHAVIOUR_PROOF:/u.test(ship) && !packed)
    || (packed && !/^ {6}PHONE_PROOF: 'retired-g989'$/mu.test(ship))
    || groups?.length !== 4 || new Set(groups).size !== 4 || !groups.every(name => reviewed.has(name))
    || matrix?.length !== shards || matrix.some((index, i) => index !== i + 1)
    || !source.includes(`node scripts/vitest-plan.ts --shards ${shards} --workers 2`)
    || !behaviour?.includes(`--config scripts/vitest-ci.config.ts --shard=\${{ matrix.shard }}/${shards} --bail=0`)
    || !/^ {6}MERGED_BOOT_PROOF: 'v1'$/mu.test(ship)
    || !/^ {4}needs: prepare$/mu.test(stage)
    || !/^ {4}if: \$\{\{ github.event_name == 'push' && needs.prepare.result == 'success' \}\}$/mu.test(stage)
    || !/^ {4}continue-on-error: true$/mu.test(stage)
    || !stage.includes(`receipt: \${{ steps.complete.outputs.receipt }}`)
    || !stage.includes('run: python3 scripts/staged-deployment.py stage --sha "$DEPLOY_SHA" --run "$SOURCE_RUN" --attempt "$SOURCE_ATTEMPT"')
    || !stage.includes('run: python3 scripts/staged-deployment.py complete --sha "$DEPLOY_SHA" --run "$SOURCE_RUN" --attempt "$SOURCE_ATTEMPT"')
    || !ship.includes('CI_WAVE_STAGE: v1'))
    throw new Error('Source optional stage topology differs');
  return true;
}

/** Recognize only the reviewed merged publisher; historical source keeps its
 * separate boot-verdict job and unchanged proof requirements. @param {string} source */
function mergedBootSource(source) {
  const ship = /\n {2}build-and-deploy:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1] ?? '';
  if (!/^ {6}MERGED_BOOT_PROOF: 'v1'$/mu.test(ship)) return false;
  const needs = /^ {4}needs: \[([^\]]+)\]$/mu.exec(ship)?.[1]?.split(',').map(name => name.trim());
  const required = ['prepare','typecheck-lint','behaviour','native-escape','journeys'];
  const staged = stagedBootSource(source);
  const prerequisiteCount = required.length + (staged ? 1 : 0);
  const release = `(github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && ${required.map(name => `needs.${name}.result == 'success'`).join(' && ')}))`;
  const group = `\${{ ${release} && 'production-release' || format('boot-verdict-{0}', github.run_id) }}`;
  if (needs?.length !== prerequisiteCount || new Set(needs).size !== prerequisiteCount
    || (staged && !needs.includes('stage-prebuilt'))
    || !required.every(name => needs.includes(name)) || /\n {2}boot-verdict:\n/u.test(source)
    || /^ {6}group: (.+)$/mu.exec(ship)?.[1] !== group
    || !/^ {6}cancel-in-progress: false$/mu.test(ship)
    || !/^ {4}steps:\n {6}- name: Publish exact-SHA proof outcome\n {8}id: boot\n/mu.test(ship)
    || !ship.includes(`CI_WAVE_BOOT_OUTCOME: \${{ steps.boot.outcome }}`))
    throw new Error('Source merged boot publisher topology differs');
  return true;
}

const packedJourneyCases = [
  ['boot-public','Every public shard reaches real page-ready','node scripts/parity/boot-smoke.mjs --case-group=public'],
  ['developer-webkit','Experimental shards reach real page-ready','node scripts/parity/boot-smoke.mjs --case-group=developer'],
  ['grid-chromium','Grid home and Signal road entry reach real page-ready','node scripts/parity/boot-smoke.mjs --case-group=grid'],
  ['grid-chromium','Chromium touch HOVER mounts in the template and on the grid road','node scripts/parity/hover-touch.mjs --out=boot-smoke-results/hover-chromium'],
  ['developer-webkit','WebKit touch HOVER mounts in the template and on the grid road','scripts/browser-lane.sh --max 8 node scripts/parity/hover-touch.mjs --engine=webkit --out=boot-smoke-results/hover-webkit'],
  ['developer-webkit','WebKit world and held-item rendering','scripts/browser-lane.sh --max 3 node scripts/webkit-render-smoke.mjs --dist=dist'],
  ['explorer','Every primary Model Explorer draws its actual catalogue','node scripts/parity/explorer-smoke.mjs --case-group=all'],
];

/** Exact physical jobs for the source's logical SIX. The split is an explicit
 * reviewed lineage, never a blanket 37-or-38 job allowance. Historical sources
 * keep their original single Explorer job. @param {string} source */
function sourceJourneyParts(source) {
  const original=['boot-public','boot-developer','boot-grid','hover-chromium','hover-webkit','explorer'];
  const ship=/\n {2}build-and-deploy:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1]??'';
  const journeys=/\n {2}journeys:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1]??'';
  const parts=/^\s+part: \[([^\]]+)\]/mu.exec(journeys)?.[1]?.split(',').map(part=>part.trim());
  const packed=/^ {6}JOURNEYS_PROOF: 'four-g989'$/mu.test(ship);
  if(/JOURNEYS_PROOF:/u.test(ship)&&!packed)throw new Error('Source packed journey marker differs');
  if(packed){
    const groups=['explorer','boot-public','developer-webkit','grid-chromium'];
    const cases=packedJourneyCases.every(([group,name,command])=>journeys.includes(`      - name: ${name}\n        if: \${{ !cancelled() && steps.inputs.outcome == 'success' && matrix.part == '${group}' }}\n        run: ${command}\n`));
    if(!stagedBootSource(source)||!/BEHAVIOUR_PROOF: 'twelve-g989'/u.test(ship)||/EXPLORER_PROOF:/u.test(ship)
      ||parts?.length!==groups.length||new Set(parts).size!==groups.length||!groups.every(group=>parts.includes(group))
      ||!/^ {4}needs: prepare$/mu.test(journeys)||!/^ {4}runs-on: macos-15$/mu.test(journeys)
      ||!/^ {4}timeout-minutes: 20$/mu.test(journeys)||!/^ {6}fail-fast: false$/mu.test(journeys)
      ||!/^ {6}max-parallel: 4$/mu.test(journeys)||!cases
      ||!journeys.includes('      - name: Unpack and verify the tested dist\n        id: inputs\n')
      ||!journeys.includes(`SMOKE_PART: \${{ matrix.part == 'boot-public' && 'boot-public' || matrix.part == 'developer-webkit' && 'hover-webkit' || matrix.part == 'grid-chromium' && 'boot-grid' || 'explorer' }}`)
      ||!journeys.includes(`name: boot-dist-\${{ matrix.part == 'boot-public' && 'boot-public' || 'worlds' }}`))
      throw new Error('Source packed journey topology differs');
    return groups;
  }
  const marked=/^ {6}EXPLORER_PROOF: 'split-v1'$/mu.test(ship);
  if(!marked){
    if(parts?.some(part=>part.startsWith('explorer-')) || /EXPLORER_PROOF:/u.test(ship))
      throw new Error('Source Explorer split marker differs');
    return original;
  }
  const split=['explorer-a','explorer-b','boot-public','boot-developer','hover-webkit','boot-grid','hover-chromium'];
  if(!stagedBootSource(source) || parts?.length!==split.length || new Set(parts).size!==split.length
    || !split.every(part=>parts.includes(part))
    || !/^ {4}needs: prepare$/mu.test(journeys) || !/^ {4}runs-on: macos-15$/mu.test(journeys)
    || !/^ {4}timeout-minutes: 20$/mu.test(journeys) || !/^ {6}fail-fast: false$/mu.test(journeys)
    || !/^ {6}max-parallel: 5$/mu.test(journeys)
    || !journeys.includes("if: matrix.part == 'explorer-a' || matrix.part == 'explorer-b'")
    || !journeys.includes(`run: node scripts/parity/explorer-smoke.mjs --case-group=\${{ matrix.part }}`)
    || !journeys.includes(`SMOKE_PART: \${{ (matrix.part == 'explorer-a' || matrix.part == 'explorer-b') && 'explorer' || matrix.part }}`))
    throw new Error('Source Explorer split topology differs');
  return split;
}

/** No asynchronous work or synthetic verdict can stand in for the real first
 * publisher step. @param {SourceJob[]} details @param {number} run @param {number} attempt @param {string} sha */
function mergedBootJob(details, run, attempt, sha) {
  for (const job of details) {
    if (job.run_id !== run || job.run_attempt !== attempt || job.head_sha !== sha)
      throw new Error('Merged source job identity differs');
  }
  const ships = details.filter(job => job.name === 'build-and-deploy');
  if (ships.length !== 1 || ships[0] === undefined || !Array.isArray(ships[0].steps))
    throw new Error('Merged source publisher inventory differs');
  const ship = ships[0];
  const steps = ship.steps ?? [];
  const unstarted = ((ship.status === 'queued' && ship.conclusion === null)
    || (ship.status === 'completed' && ship.conclusion === 'cancelled'))
    && steps.every(step => ['queued','pending'].includes(step.status) && step.conclusion === null);
  const publishers = steps.filter(step => step.name === 'Publish exact-SHA proof outcome');
  const published = publishers.length === 1 && publishers[0]?.status === 'completed'
    && publishers[0].conclusion === 'success';
  return { ship, unstarted, published };
}

/** @typedef {{state:string,target_url:string,description:string,created_at:string}} BootStatus */
/** @param {string} sha @param {(args:string[])=>string} query @returns {BootStatus|null} */
function mergedBootStatus(sha, query) {
  /** @type {unknown} */
  const status = JSON.parse(query([`repos/${REPO}/commits/${sha}/status`, '--paginate', '--slurp', '--jq',
    '[.[].statuses[] | select(.context == "boot-smoke") | {state,target_url,description,created_at}][0] // null']));
  if (status === null) return null;
  if (typeof status !== 'object' || !('state' in status) || typeof status.state !== 'string'
    || !('target_url' in status) || typeof status.target_url !== 'string'
    || !('description' in status) || typeof status.description !== 'string'
    || !('created_at' in status) || typeof status.created_at !== 'string')
    throw new SourceGateError('Merged source boot status is unreadable');
  return {state:status.state,target_url:status.target_url,description:status.description,created_at:status.created_at};
}

/** @param {string} run @param {number} attempt @param {string} six */
function manualBootDescription(run, attempt, six) {
  return `Manual merged-v1 SIX: source ${run}/${attempt}; through ${six}`;
}

/** A POST whose readback failed can be resumed only by its same real source
 * proof, not by an unrelated success or a changed SIX/attempt.
 * @param {BootStatus|null} status @param {string} run @param {number} attempt @param {string} six */
function manualBootMatches(status, run, attempt, six) {
  return status !== null && status.state === 'success'
    && status.target_url === `https://github.com/${REPO}/actions/runs/${run}`
    && status.description === manualBootDescription(run, attempt, six)
    && Number.isFinite(Date.parse(status.created_at)) && Date.parse(status.created_at) >= Date.parse(six);
}

/** @param {string} runId @param {(args:string[])=>string} query @param {boolean} deadline @param {boolean} [ready] */
function recoveryEvidence(runId, query, deadline, ready = false) {
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('Recovery requires a numeric source run');
  const run = JSON.parse(query([`repos/${REPO}/actions/runs/${runId}`]));
  const workflowId = workflowRunsPath('deploy.yml', query).split('/').at(-2);
  if (String(run.id) !== runId || String(run.workflow_id) !== workflowId || run.event !== 'push'
    || run.head_branch !== 'main' || typeof run.head_sha !== 'string' || !/^[a-f0-9]{40}$/u.test(run.head_sha)
    || (ready ? !((['queued','pending','in_progress'].includes(run.status) && run.conclusion === null)
      || (run.status === 'completed' && ['success','failure','cancelled'].includes(run.conclusion)))
      : run.status !== 'completed' || !['success','failure'].includes(run.conclusion))
    || run.path !== '.github/workflows/deploy.yml' || run.head_repository?.full_name !== REPO)
    throw new Error('Recovery source is not a completed exact main push');
  const sha = String(run.head_sha);
  const ancestry = JSON.parse(query([`repos/${REPO}/compare/${sha}...main`, '--jq',
    '{status,base_commit:{sha:.base_commit.sha}}']));
  if (ancestry.base_commit?.sha !== sha || !['ahead','identical'].includes(ancestry.status))
    throw new Error('Recovery source is outside main ancestry');
  const source = query([`repos/${REPO}/contents/.github/workflows/deploy.yml?ref=${sha}`,
    '-H','Accept: application/vnd.github.raw+json']);
  const merged = mergedBootSource(source);
  const nativeFixtures = nativeFixtureSource(source);
  if (merged && (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1))
    throw new Error('Merged source attempt identity is unreadable');
  // The complete behavior wave owned the native file before its dedicated job.
  const native = /\n {2}native-escape:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  let nativeJobs = native === undefined ? [] : ['native-escape'];
  if (native?.includes('matrix:')) {
    const groups = /^\s+group: \[([^\]]+)\]/mu.exec(native)?.[1]?.split(',').map(group => group.trim());
    const reviewed = groups?.length === 4 ? ['escape-titan','stories-qara','chapter-one','native-routes']
      : groups?.length === 3 ? ['escape-titan','stories-qara','chapter-one'] : ['escape-titan','stories-qara'];
    if (groups?.length !== reviewed.length || new Set(groups).size !== reviewed.length
      || !groups.every(group => reviewed.includes(group)))
      throw new Error('Recovery source has an unreviewed native topology');
    nativeJobs = groups.map(group => `native-escape (${group})`);
  }
  const phone = /\n {2}phone-route:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  const retiredPhone = /^ {6}PHONE_PROOF: 'retired-g989'$/mu.test(source);
  if (retiredPhone && (!merged || !stagedBootSource(source)))
    throw new Error('Retired phone policy requires the reviewed staged source');
  if (retiredPhone ? phone !== undefined || source.includes(`continue-on-error: \${{ matrix.part == 'phone-route' }}`)
    : phone === undefined ? !source.includes(`continue-on-error: \${{ matrix.part == 'phone-route' }}`)
    : !/(?:^|\n) {4}continue-on-error: true(?:\n|$)/u.test(phone))
    throw new Error('Recovery source lacks the reviewed report-only phone policy');
  // Recovery must use the selected source's reviewed topology, not today's
  // count: earlier exact-SIX proofs retain their original twelve-job wave.
  const behaviour = /\n {2}behaviour:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  const matrix = /^\s+shard: \[([\d, ]+)\]/mu.exec(behaviour ?? '')?.[1]?.split(',').map(Number);
  if (matrix === undefined || ![12,24].includes(matrix.length) || matrix.some((index, i) => index !== i + 1)
    || !source.includes(`node scripts/vitest-plan.ts --shards ${matrix.length} --workers 2`)
    || !behaviour?.includes(`--config scripts/vitest-ci.config.ts --shard=\${{ matrix.shard }}/${matrix.length} --bail=0`))
    throw new Error('Recovery source has an unreviewed behavior topology');
  if (nativeJobs.length === 4 && !merged)
    throw new Error('Independent native routes require the reviewed merged topology');
  const packedBehaviour = /^ {6}BEHAVIOUR_PROOF: 'twelve-g989'$/mu.test(source);
  if (merged && (matrix.length !== (packedBehaviour ? 12 : 24) || ![2,3,4].includes(nativeJobs.length)))
    throw new Error('Merged source requires the reviewed full behavior and native topology');
  const journeyParts=sourceJourneyParts(source);
  const required = new Set(['prepare','typecheck-lint',...(merged ? [] : ['boot-verdict']),
    ...matrix.map(index=>`behaviour (${index})`),
    ...journeyParts.map(name=>`journeys (${name})`),
    ...nativeJobs]);
  const jobsPath = merged ? `repos/${REPO}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`
    : `repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`;
  /** @type {SourceJob[]|null} */
  const details = ready || merged ? JSON.parse(query([jobsPath, '--paginate', '--slurp', '--jq', merged
    ? '[.[].jobs[] | {name,status,conclusion,created_at,started_at,completed_at,run_id,run_attempt,head_sha,steps:[.steps[]|{name,status,conclusion,number}]}]'
    : '[.[].jobs[] | {name,status,conclusion,created_at,started_at,completed_at}]'])) : null;
  if ((ready || merged) && !Array.isArray(details)) throw new Error('Ready source job inventory is unreadable');
  if(details!==null&&/^ {6}JOURNEYS_PROOF: 'four-g989'$/mu.test(source))for(const [group,name]of packedJourneyCases){
    const jobs=details.filter(job=>job.name===`journeys (${group})`);
    const steps=jobs[0]?.steps?.filter(step=>step.name===name);
    if(jobs.length!==1||steps?.length!==1||steps[0]?.status!=='completed'||steps[0].conclusion!=='success')
      throw new SourceGateError(`Packed journey case has no successful exact-run verdict: ${name}`);
  }
  const rows = details !== null ? details.map(job => [job.name, job.status, job.conclusion ?? ''].join('\t'))
    : query([`repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`, '--paginate', '--jq',
      '.jobs[] | [.name, .status, .conclusion] | @tsv']).split(/\r?\n/u).filter(Boolean);
  const optional = new Set(['build-and-deploy',...retiredPhone ? [] : [phone === undefined ? 'journeys (phone-route)' : 'phone-route']]);
  const drawBudget = /\n {2}draw-budget:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
  const prDraw = /^ {6}DRAW_PROOF: 'pr-only-g989'$/mu.test(source);
  if ((/DRAW_PROOF:/u.test(source) && !prDraw) || (prDraw && (drawBudget === undefined
    || !/^ {6}JOURNEYS_PROOF: 'four-g989'$/mu.test(source)
    || !drawBudget.includes(`    if: \${{ always() && !cancelled() && needs.prepare.result == 'success' && github.event_name == 'pull_request' }}\n`))))
    throw new Error('Source PR-only draw policy differs');
  if (drawBudget !== undefined) {
    if (!/(?:^|\n) {4}continue-on-error: true(?:\n|$)/u.test(drawBudget))
      throw new Error('Source draw-budget job lacks the reviewed report-only policy');
    optional.add('draw-budget');
  }
  // Fixture snapshots only accelerate a source whose successful behaviour
  // jobs already prove their fallback. Preserve the selected ship's policy.
  if ((ready || merged) && /\n {2}fixtures:\n/u.test(source)) {
    const ship = /\n {2}build-and-deploy:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u.exec(source)?.[1];
    const needs = /^\s+needs: \[([^\]]+)\]/mu.exec(ship ?? '')?.[1]?.split(',').map(name => name.trim());
    if (needs === undefined) throw new Error('Ready source ship has no reviewed prerequisite list');
    (needs.includes('fixtures') || nativeFixtures ? required : optional).add('fixtures');
  }
  if (stagedBootSource(source)) optional.add('stage-prebuilt');
  const essential = new Set(['prepare',...(nativeFixtures ? ['fixtures'] : []),...(merged ? [] : ['boot-verdict']),
    ...journeyParts.map(name=>`journeys (${name})`)]);
  /** @type {{name:string,status:string,conclusion:string}[]} */
  const jobs = [];
  for (const row of rows) {
    const [name='',status,conclusion] = row.split('\t');
    if (row.split('\t').length !== 3 || conclusion === undefined)
      throw new Error(`Recovery job has an unreadable verdict: ${name}`);
    if (!required.has(name) && !optional.has(name)) throw new Error('Recovery job inventory differs');
    if ((ready || name === 'draw-budget' || name === 'stage-prebuilt') && optional.delete(name)) {
      if (name === 'stage-prebuilt' && status !== 'completed')
        throw new SourceGateError('Optional stage must be terminal before fallback');
      if (!['completed','queued','in_progress'].includes(status)
        || (status !== 'completed' && conclusion !== '')
        || (status === 'completed' && !['success','failure','cancelled','timed_out','skipped'].includes(conclusion)))
        throw new Error(`Source optional verdict is unreadable: ${name}`);
      jobs.push({name,status,conclusion}); continue;
    }
    if (status !== 'completed') throw new SourceGateError(`Recovery job has no completed verdict: ${name}`);
    if (optional.delete(name)) {
      const terminal = deadline ? ['success','failure','timed_out',...(name === 'build-and-deploy' ? ['skipped'] : [])] : ['success','failure'];
      if (!terminal.includes(conclusion))
        throw new Error(`Recovery terminal job did not finish: ${name}`);
    } else if (!required.delete(name) || (deadline && !essential.has(name)
      ? !['success','failure','timed_out'].includes(conclusion) : conclusion !== 'success'))
      throw new SourceGateError(`Recovery source gate did not succeed: ${name}`);
    jobs.push({name,status,conclusion});
  }
  if (required.size > 0 || optional.size > 0) throw new SourceGateError('Recovery job inventory differs');
  if (nativeFixtures) {
    if (details === null) throw new SourceGateError('Native fixture input jobs lack exact metadata');
    for (const [name, expectedStep] of [['fixtures','Publish source-host native constructor inputs'],
      ...nativeJobs.map(jobName => [jobName,'Restore source-host native constructor inputs']),
      ...(nativeFixtures === 'v2' || nativeFixtures === 'v3' || nativeFixtures === 'v4' ? matrix.map(index => [`behaviour (${index})`,'Restore source-host native constructor inputs']) : [])]) {
      const matches = details.filter(job => job.name === name), job = matches[0];
      if (matches.length !== 1 || job === undefined || job.run_id !== Number(runId)
        || job.run_attempt !== run.run_attempt || job.head_sha !== sha)
        throw new SourceGateError(`Native fixture input job has foreign metadata: ${name}`);
      const steps = job.steps?.filter(step => step.name === expectedStep), step = steps?.[0];
      if (steps?.length !== 1 || step === undefined || step.status !== 'completed' || step.conclusion !== 'success')
        throw new SourceGateError(`Native fixture input step did not succeed: ${name}`);
    }
  }

  const publisher = merged && details !== null ? mergedBootJob(details, Number(runId), run.run_attempt, sha) : null;
  let bootPublishRequired = false, bootAlreadyPublished = false;
  /** @type {string|null} */
  let sixCompletedAt = null;
  if (publisher !== null && details !== null) {
    const six = details.filter(job => job.name.startsWith('journeys (') && job.name !== 'journeys (phone-route)');
    const completed = six.map(job => Date.parse(job.completed_at ?? ''));
    if (completed.length !== journeyParts.length || completed.some(at => !Number.isFinite(at)))
      throw new SourceGateError('Merged source SIX completion times are unreadable');
    sixCompletedAt = new Date(Math.max(...completed)).toISOString();
    const boot = mergedBootStatus(sha, query);
    if (!publisher.published) {
      // A manual release can evict a pending source from the same lock. Its
      // unstarted cancellation keeps the original thirty-minute age check.
      bootAlreadyPublished = manualBootMatches(boot, runId, run.run_attempt, sixCompletedAt);
      bootPublishRequired = ready && publisher.unstarted && (boot === null || bootAlreadyPublished);
      if (!bootPublishRequired) throw new SourceGateError('Recovery requires the actual successful boot publisher step');
    } else if (boot?.state !== 'success' || boot.target_url !== `https://github.com/${REPO}/actions/runs/${runId}`)
      throw new SourceGateError('Recovery requires the latest successful same-run boot status');
  } else {
    const boot = query([`repos/${REPO}/commits/${sha}/status`, '--paginate', '--jq',
      '.statuses[] | select(.context == "boot-smoke") | [.state, .target_url] | @tsv']).trim().split('\n')[0];
    if (boot !== `success\thttps://github.com/${REPO}/actions/runs/${runId}`)
      throw new SourceGateError('Recovery requires the latest successful same-run boot status');
  }
  return {sha,run:runId,jobs,failures:jobs.filter(job=>['failure','timed_out','cancelled'].includes(job.conclusion)),
    aggregate:{status:run.status,conclusion:run.conclusion},ship:details?.find(job=>job.name === 'build-and-deploy'),
    bootPublishRequired,bootAlreadyPublished,sixCompletedAt,runAttempt:merged ? Number(run.run_attempt) : null};
}

/** An explicit manual backstop reuses a proven source's existing prebuilt
 * artifact. A failed/queued ship never manufactures aggregate CI success.
 * @param {string} runId @param {string} liveBuild @param {(args:string[])=>string} [query] @param {number} [now] */
export function readySource(runId, liveBuild, query = ghApi, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Ready source requires a valid current clock');
  const selected = recoveryEvidence(runId, query, false, true), ship = selected.ship;
  const queuedAt = Date.parse(ship?.created_at ?? '');
  const queued = ship?.status === 'queued' && ship.conclusion === null
    && Number.isFinite(queuedAt) && now - queuedAt >= 30 * 60 * 1000;
  const terminal = ship?.status === 'completed' && ship.conclusion !== null && ['failure','cancelled'].includes(ship.conclusion);
  if (selected.bootPublishRequired && (!Number.isFinite(queuedAt) || now - queuedAt < 30 * 60 * 1000))
    throw new Error('Unstarted merged source requires at least 30 minutes queued');
  if (!queued && !terminal) throw new Error('Ready source requires failed/cancelled shipping or at least 30 minutes queued');
  if (productionFloor(liveBuild, selected.sha, query) === selected.sha)
    throw new Error('Ready source is already live');
  const live = query([`repos/${REPO}/commits/${selected.sha}/status`, '--jq',
    '[.statuses[] | select(.context == "production-live")][0].state // ""']).trim();
  if (live === 'success') throw new Error('Ready source already has a verified production release');
  /** @type {{workflow_runs:{id:number,status:string}[]}} */
  const runs = JSON.parse(query([`${workflowRunsPath('deploy.yml', query)}?branch=main&event=push&per_page=100&page=1`,
    '--jq', '{workflow_runs:[.workflow_runs[]|{id,status}]}']));
  if (!Array.isArray(runs.workflow_runs) || runs.workflow_runs.length > 100
    || !runs.workflow_runs.some(run => String(run.id) === runId))
    throw new Error('Ready source is outside the bounded current push inventory');
  for (const run of runs.workflow_runs) {
    if (!/^[1-9][0-9]*$/u.test(String(run.id))) throw new Error('Ready source has an invalid neighbouring run');
    if (BigInt(run.id) <= BigInt(runId)) continue;
    try { recoveryEvidence(String(run.id), query, false, true); }
    catch (error) { if (error instanceof SourceGateError) continue; throw error; }
    throw new Error(`Use newer proven source run ${run.id} instead`);
  }
  return {...selected,authority:'ready-source',reason:queued?'queued-30m':selected.bootPublishRequired?'cancelled-before-start-30m':'terminal-ship',verifiedAt:new Date(now).toISOString(),liveBuild};
}

/** A POST can have succeeded even when its response was lost. Leave it to the
 * verified manual-receipt resume instead of retrying a write over a new status.
 * Existing GET retry policy remains unchanged. @param {string[]} args */
function readyPublisherApi(args) {
  return args.includes('POST')
    ? execFileSync('gh', ['api','-H','Cache-Control: no-cache',...args], {encoding:'utf8'})
    : ghApi(args);
}

/** Finish only an explicit manual backstop's missing publisher. Archive restore
 * and re-admission precede the POST; its successful exact-run readback precedes
 * any caller's deployment outputs. Selection itself stays read-only.
 * @param {ReturnType<typeof readySource>} selected
 * @param {(proof:ReturnType<typeof readySource>)=>string} restore
 * @param {()=>ReturnType<typeof readySource>} recheck
 * @param {(args:string[])=>string} [query] */
export function completeReadySource(selected, restore, recheck, query = readyPublisherApi) {
  if (!selected.bootPublishRequired) return {...selected,prebuiltArchive:null,bootPublished:false};
  const archive = restore(selected);
  const fresh = recheck();
  if (fresh.sha !== selected.sha || fresh.run !== selected.run || fresh.runAttempt !== selected.runAttempt
    || fresh.sixCompletedAt !== selected.sixCompletedAt)
    throw new Error('Restored ready source identity or attempt changed');
  if (!fresh.bootPublishRequired) return {...fresh,prebuiltArchive:archive,bootPublished:false};
  if (fresh.runAttempt === null || fresh.sixCompletedAt === null) throw new Error('Missing merged publisher identity');
  if (!fresh.bootAlreadyPublished) query([`repos/${REPO}/statuses/${fresh.sha}`, '--method','POST',
    '-f','context=boot-smoke','-f','state=success',
    '-f',`description=${manualBootDescription(fresh.run, fresh.runAttempt, fresh.sixCompletedAt)}`,
    '-f',`target_url=https://github.com/${REPO}/actions/runs/${fresh.run}`]);
  if (!manualBootMatches(mergedBootStatus(fresh.sha, query), fresh.run, fresh.runAttempt, fresh.sixCompletedAt))
    throw new Error('Ready source boot publication readback differs');
  return {...fresh,prebuiltArchive:archive,bootPublished:!fresh.bootAlreadyPublished};
}

/** Verify a manual publisher's complete archive outside the checkout. The
 * selected-source checkout can remove its workspace, so the later release
 * restores and revalidates this same cached archive after checkout again.
 * @param {{sha:string,run:string}} proof @param {string} runnerTemp
 * @param {(command:string,args:string[])=>void} [run] */
export function stageReadyArchive(proof, runnerTemp, run = (command, args) => { execFileSync(command, args, {stdio:'inherit'}); }) {
  if (!isAbsolute(runnerTemp) || !/^[a-f0-9]{40}$/u.test(proof.sha) || !/^[1-9][0-9]*$/u.test(proof.run))
    throw new Error('Invalid ready archive staging identity');
  const stage = mkdtempSync(join(runnerTemp, 'ready-source-'));
  const archive = join(stage, 'prebuilt-output'), verified = join(stage, 'verified-root');
  mkdirSync(verified);
  try {
    run('gh', ['run','download',proof.run,'--repo',REPO,'--name','vercel-prebuilt','--dir',archive]);
    run('python3', [fileURLToPath(new URL('prebuilt-output.py', import.meta.url)),
      'restore','--root',verified,'--directory',archive,'--sha',proof.sha,'--run',proof.run]);
    return archive;
  } finally { rmSync(verified, {recursive:true,force:true}); }
}

/** Bind the current push's successful wave before its own ship job completes.
 * GitHub supplies needs from this exact run; no neighbouring aggregate grants proof.
 * The merged publisher supplies its actual successful step outcome; historical
 * callers retain the separate completed boot-verdict job instead.
 * @param {{mode:string,event:string,ref:string,repository:string,sha:string,run:string,head:string,needs:unknown,bootOutcome?:string|undefined,staged?:boolean|undefined}} input
 * @returns {{skip:boolean,sha:string,run:string}} */
export function waveSource(input) {
  if (input.event !== 'push' || input.ref !== 'refs/heads/main' || input.repository !== REPO
    || !/^[a-f0-9]{40}$/u.test(input.sha) || input.head !== input.sha || !/^[1-9][0-9]*$/u.test(input.run))
    throw new Error('Wave source is not the exact main push checkout');
  if (typeof input.needs !== 'object' || input.needs === null || Array.isArray(input.needs))
    throw new Error('Missing exact-run wave verdicts');
  const merged = input.bootOutcome !== undefined;
  if (merged && input.bootOutcome !== 'success') throw new Error('Wave boot publisher did not succeed');
  const required = ['prepare','typecheck-lint','behaviour','native-escape','journeys',
    ...(merged ? [] : ['boot-verdict'])];
  /** @type {Map<string, unknown>} */
  const rows = new Map(Object.entries(input.needs));
  if (input.staged === true) {
    if (!merged) throw new Error('Optional stage requires the merged publisher');
    const stage = rows.get('stage-prebuilt');
    if (typeof stage !== 'object' || stage === null || !('result' in stage)
      || !['success','failure','cancelled','skipped'].includes(String(stage.result)))
      throw new Error('Wave optional stage verdict is unreadable');
    rows.delete('stage-prebuilt');
  }
  if (rows.size !== required.length) throw new Error('Wave verdict inventory differs');
  for (const name of required) {
    const row = rows.get(name);
    if (typeof row !== 'object' || row === null || !('result' in row) || row.result !== 'success')
      throw new Error(`Wave prerequisite did not succeed: ${name}`);
  }
  return {skip:input.mode !== 'newest-ci-green',sha:input.sha,run:input.run};
}

/** No CI-green SHA has a successful exact-SHA smoke yet. */
export class PendingBootSmokeError extends Error {
  /** @param {string} sha */
  constructor(sha) { super(`newest-ci-green: awaiting exact-SHA boot-smoke for ${sha}`); this.name = 'PendingBootSmokeError'; this.sha = sha; }
}

/** The newest successful push CI on main with a separate, successful real boot on that exact SHA.
 * A newer pending smoke never delays an already proven candidate. With no proven candidate,
 * pending smoke can defer selection; unproven/failing boots never become a release pin.
 * @param {(args:string[])=>string} [query] @param {(line: string) => void} [log] @param {number} [now] @returns {string} */
export function newestCiGreen(query = ghApi, log = (line) => console.error(line), now = Date.now()) {
  const candidates = query([`${workflowRunsPath('deploy.yml', query)}?branch=main&event=push&status=success&per_page=100&page=1`,
    '--jq', '.workflow_runs[] | [.head_sha, .updated_at] | @tsv']).trim().split('\n');
  const seen = new Set();
  let pending;
  for (const row of candidates) {
    const [sha = '', completed = ''] = row.split('\t');
    if (seen.has(sha)) continue;
    seen.add(sha);
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    const proof = statuses(sha, query), boot = proof.get('boot-smoke');
    const completedAt = Date.parse(completed);
    if (Number.isNaN(completedAt)) throw new Error(`newest-ci-green: unreadable completed CI time for ${sha}`);
    if (boot?.state === 'success') return sha;
    if (boot?.state === 'pending' || (!boot && now - completedAt >= 0 && now - completedAt < 15 * 60 * 1000)) {
      pending ??= sha;
      continue;
    }
    log(`newest-ci-green: skipped ${sha.slice(0, 9)}: push CI green, boot-smoke ${boot ? `${boot.state} (${boot.description})` : 'not run yet'}`);
  }
  if (pending !== undefined) throw new PendingBootSmokeError(pending);
  throw new Error('newest-ci-green: no successful push CI with a successful exact-SHA boot-smoke in the last 100 runs');
}

/** Dispatch readiness for the newest fully proven candidate. Newer pending proofs do not spend
 * or block the hourly slot; actual releases reselect and enforce every exact-SHA proof.
 * @param {(args:string[])=>string} [query] @param {(line:string)=>void} [log] @param {number} [now]
 * @returns {{ready:boolean, sha:string}} */
export function releaseReady(query = ghApi, log = (line) => console.error(line), now = Date.now()) {
  try { return { ready: true, sha: newestCiGreen(query, log, now) }; } catch (error) {
    if (!(error instanceof PendingBootSmokeError)) throw error;
    log(error.message);
    return { ready: false, sha: error.sha };
  }
}

/** Wait at most 20 minutes only when no candidate has both proofs. Unresolved candidates
 * still fail closed; an existing BOTH-proof-green SHA is selected without waiting.
 * Re-read CI and statuses every 30 seconds so a newer green push or coalesced smoke is observed.
 * @param {(args:string[])=>string} [query] @param {(line:string)=>void} [log]
 * @param {{now?:()=>number, wait?:(ms:number)=>Promise<void>, maxWaitMs?:number}} [options] @returns {Promise<string>} */
export async function newestCiGreenAfterBoot(query = ghApi, log = (line) => console.error(line), options = {}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  const deadline = now() + (options.maxWaitMs ?? 20 * 60 * 1000);
  for (;;) {
    try { return newestCiGreen(query, log, now()); } catch (error) {
      if (!(error instanceof PendingBootSmokeError)) throw error;
      if (now() >= deadline) throw new Error(`release refused: exact-SHA boot-smoke still unresolved after wait: ${error.sha}`, { cause: error });
      log(error.message);
      await wait(Math.min(30000, deadline - now()));
    }
  }
}



/** Every SHA the pin file has held, oldest first (R1-16). */
function history() {
  const log = ok(() => git('log', '--format=%H', '--', FILE)) ? git('log', '--reverse', '--format=%H', '--', FILE).split('\n').filter(Boolean) : [];
  /** @type {Pin[]} */
  const out = [];
  for (const c of log) {
    try {
      const pin = JSON.parse(git('show', `${c}:${FILE}`));
      if (!out.some((p) => p.sha === pin.sha)) out.push(pin);
    } catch { /* a commit that deleted it */ }
  }
  return out;
}

/** @param {string} name */
function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** @param {string} sha @returns {string | null} */
function memoryReading(sha) {
  if (statuses(sha).get('gpu-perf/memory')?.state === 'success') return sha;
  // a runtime-equal ancestor with a reading (R4-15)
  for (const a of git('rev-list', '-n', '200', `${sha}^`).split('\n').filter(Boolean)) {
    if (!ok(() => git('diff', '--quiet', a, sha, '--', ...RUNTIME))) return null;
    if (statuses(a).get('gpu-perf/memory')?.state === 'success') return a;
  }
  return null;
}

async function main() {
  const [cmd, a1] = process.argv.slice(2);
  if (cmd === 'read-ready-source') {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_REPOSITORY !== REPO) throw new Error('Ready source requires an explicit main dispatch');
    const proof = process.env.READY_SOURCE_PROOF;
    if (!proof) throw new Error('Ready source requires a retained evidence path');
    const response = await fetch(`https://wildshard-singleplayer.vercel.app/version.json?ready-floor=${Date.now()}`, {
      headers:{'Cache-Control':'no-store'},signal:AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Ready source production floor returned HTTP ${response.status}`);
    const version = await response.json();
    if (typeof version?.build !== 'string') throw new Error('Ready source production floor has no build ID');
    const selected = completeReadySource(readySource(a1 ?? '', version.build),
      candidate => stageReadyArchive(candidate, process.env.RUNNER_TEMP ?? ''),
      () => readySource(a1 ?? '', version.build));
    writeFileSync(proof, `${JSON.stringify({requestRun:process.env.GITHUB_RUN_ID,actor:process.env.GITHUB_ACTOR??null,...selected},null,2)}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `sha=${selected.sha}\nmode=ready-source\ngate=required\nsource_run=${selected.run}\nrecovery=false\nskip=false\nprebuilt_archive=${selected.prebuiltArchive ?? ''}\n`);
    console.info(`Explicit prebuilt source ${selected.run}: ${selected.sha}; all source gates/SIX verified, actual aggregate ${selected.aggregate.status}/${selected.aggregate.conclusion}`);
    return 0;
  }
  if (cmd === 'check-live-floor') {
    if (!a1) throw new Error('check-live-floor <sha>');
    const response = await fetch(`https://wildshard-singleplayer.vercel.app/version.json?release-floor=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-store' }, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Production floor returned HTTP ${response.status}`);
    const version = await response.json();
    if (typeof version?.build !== 'string') throw new Error('Production floor has no build ID');
    const floor = productionFloor(version.build, a1);
    console.log(`Production floor ${floor}; target ${a1}; forward-only verified`);
    return 0;
  }
  if (cmd === 'read-recovery' || cmd === 'read-deadline-recovery') {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_REPOSITORY !== REPO) throw new Error('Recovery requires an explicit main dispatch');
    const deadline = cmd === 'read-deadline-recovery';
    const selected = deadline ? deadlineRecoverySource(a1 ?? '') : recoverySource(a1 ?? '');
    if (deadline) {
      const proof = process.env.DEADLINE_RECOVERY_PROOF;
      if (!proof) throw new Error('G917 recovery requires a retained evidence path');
      writeFileSync(proof, `${JSON.stringify({authority:'G917',deadline:'2026-10-30T10:30:00Z',verifiedAt:new Date().toISOString(),
        requestRun:process.env.GITHUB_RUN_ID,actor:process.env.GITHUB_ACTOR??null,...selected},null,2)}\n`);
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `sha=${selected.sha}\nmode=recovery\ngate=required\nsource_run=${selected.run}\nrecovery=${!deadline}\nskip=false\n`);
    console.log(deadline
      ? `G917 explicit deadline recovery ${selected.run}: ${selected.sha}; prepare/SIX/latest boot verified; actual CI verdicts retained, not CI green`
      : `Explicit source recovery ${selected.run}: ${selected.sha}; all original source gates and SIX verified`);
    return 0;
  }
  if (cmd === 'read-wave') {
    const pin = readPin();
    /** @type {unknown} */
    const needs = JSON.parse(process.env.CI_WAVE_NEEDS ?? 'null');
    const selected = waveSource({mode:pin.mode,event:process.env.GITHUB_EVENT_NAME??'',ref:process.env.GITHUB_REF??'',
      repository:process.env.GITHUB_REPOSITORY??'',sha:process.env.GITHUB_SHA??'',run:process.env.GITHUB_RUN_ID??'',
      head:git('rev-parse','HEAD'),needs,staged:process.env.CI_WAVE_STAGE === 'v1',bootOutcome:process.env.CI_WAVE_BOOT_OUTCOME});
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `sha=${selected.sha}\nmode=${pin.mode}\ngate=${pin.gate}\nci_green=true\nsource_run=${selected.run}\nskip=${selected.skip}\n`);
    console.log(`Exact push wave ${selected.run}: ${selected.sha}; automatic mode ${!selected.skip}`);
    return 0;
  }
  if (cmd === 'read') {
    const pin = readPin();
    let sha = pin.sha;
    if (pin.mode === 'newest-green') {
      const found = git('rev-list', 'origin/main', '-n', '50').split('\n').find((s) => ok(() => { if (!gateGreen(s)) throw new Error('red'); }));
      if (!found) throw new Error('newest-green: no gpu-gate-green SHA in the last 50 on origin/main');
      sha = found;
    }
    if (pin.mode === 'newest-ci-green') sha = await newestCiGreenAfterBoot();
    // An explicit emergency rollback may return to a previously live build, including pre-smoke releases.
    if (!bootGreen(sha) && !(pin.mode === 'pinned' && productionLive(sha))) {
      throw new Error(`release refused: ${sha} has neither a green boot-smoke nor prior production proof`);
    }
    const explicitCi = pin.mode === 'pinned' && pin.ciRun !== undefined && ciRunGreen(sha, pin.ciRun);
    const ciPassed = explicitCi || pin.mode === 'newest-ci-green' || ciGreen(sha);
    console.log(sha);
    if (explicitCi) console.error(`CI aggregate exception: exact run ${pin.ciRun}, every required job verified successful`);
    console.error(`Release selection: mode=${pin.mode}, exact push CI=${ciPassed}`);
    const sourceRun = ciPassed ? ciSourceRun(sha) : '';
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nmode=${pin.mode}\ngate=${pin.gate}\nci_green=${ciPassed}\nsource_run=${sourceRun}\n`);
    return 0;
  }
  if (cmd === 'release-ready') {
    const pin = readPin();
    // Other modes retain their existing release-job proof checks; this preflight defers only newest-CI dispatches.
    const candidate = pin.mode === 'newest-ci-green' ? releaseReady() : { ready: true, sha: pin.sha };
    console.log(`release readiness: ${candidate.ready ? 'ready' : 'deferred'} ${candidate.sha} (${pin.mode})`);
    const output = process.env.GITHUB_OUTPUT;
    if (output) appendFileSync(output, `ready=${candidate.ready}\nsha=${candidate.sha}\n`);
    return 0;
  }

  if (cmd === 'check-gate') {
    if (!a1) throw new Error('check-gate <sha>');
    const green = gateGreen(a1);
    console.log(`gpu-gate on ${a1.slice(0, 8)}: ${green ? 'success' : 'not success'}`);
    return green ? 0 : 1;
  }
  if (cmd === 'set') {
    const milestone = arg('--milestone');
    const go = arg('--go');
    if (!a1 || !milestone || !go) throw new Error('set <sha> --milestone M<n> --go "<where Jake OKed>"');
    const sha = git('rev-parse', a1);
    /** @param {string} why */
    const refuse = (why) => { console.error(`deploy-pin set: refused — ${why}`); return 1; };
    if (!ok(() => git('merge-base', '--is-ancestor', sha, 'origin/main'))) return refuse(`${sha.slice(0, 8)} is not on origin/main`);
    const st = statuses(sha);
    if (st.get('gpu-gate')?.state !== 'success') return refuse('gpu-gate is not success');
    let pending;
    try { pending = JSON.parse(git('show', `${sha}:${PENDING}`)); } catch { pending = []; }
    if (Array.isArray(pending) ? pending.length > 0 : Object.keys(pending).length > 0) return refuse(`${PENDING} has entries at that SHA`);
    const boot = [...st].filter(([c, s]) => c.startsWith('gpu-gate/') && s.description.startsWith('bootstrap record'));
    if (boot.length > 0) return refuse(`bootstrap-only records: ${boot.map(([c]) => c).join(', ')}`);
    const mem = memoryReading(sha);
    if (!mem) return refuse(`no gpu-perf/memory success on it or a runtime-equal ancestor: run scripts/gpu-perf/nightly.sh --memory-only --sha=${sha}`);
    writePin({ ...readPin(), mode: 'pinned', sha, milestone, gate: 'required', go, set: new Date().toISOString(), by: 'E357 lead' });
    console.log(`pinned ${sha.slice(0, 8)} as ${milestone} (memory reading on ${mem.slice(0, 8)}). Commit ${FILE} alone, push, gh workflow run deploy.`);
    return 0;
  }
  if (cmd === 'rollback') {
    const go = arg('--go');
    if (!a1 || !go) throw new Error('rollback <sha> --go "<Jake\'s words>"');
    const sha = git('rev-parse', a1);
    if (!productionLive(sha)) { console.error(`deploy-pin rollback: refused — ${sha.slice(0, 8)} has no prior production proof`); return 1; }
    const old = history().find((p) => p.sha === sha) ?? readPin();
    writePin({ ...old, mode: 'pinned', sha, gate: 'grandfathered', milestone: `${old.milestone}-rollback`, go, set: new Date().toISOString(), by: 'E357 lead' });
    const f10 = ok(() => git('merge-base', '--is-ancestor', sha, 'HEAD')) && !ok(() => git('show', `${sha}:src/shared/engine/saves/store.ts`));
    if (f10) console.log('NOTE: this build predates SaveStore (F10): it cannot read the v2 saves made since, so progress resets again (decision 95). Tell Jake.');
    console.log(`rolled back to ${sha.slice(0, 8)} (${old.milestone}). Commit ${FILE} alone, push, gh workflow run deploy.`);
    return 0;
  }
  if (cmd === 'mode') {
    const go = arg('--go');
    if ((a1 !== 'newest-green' && a1 !== 'newest-ci-green') || !go) throw new Error('mode newest-green | newest-ci-green --go "<…>"');
    writePin({ ...readPin(), mode: a1, gate: 'grandfathered', go, set: new Date().toISOString(), by: 'E357 lead' });
    return 0;
  }
  console.error('usage: deploy-pin.mjs read | release-ready | check-gate <sha> | set <sha> --milestone M<n> --go "…" | rollback <sha> --go "…" | mode newest-green|newest-ci-green --go "…"');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
