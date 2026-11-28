#!/usr/bin/env node
// The preview, staging and production page release (meta OFF-VERCEL OV4). Runbook: docs/server-release.md "Page release".
//
//   node src/scripts/page-release.mjs <preview|staging|production|explore> <phase>[,<phase>...] [options]
//
//   phases: build, upload, check, go-live, in that order; a comma list runs them one after another and stops at the first
//   failure (preview.yml: `preview build,upload,check,go-live`)
//   --host=workers           the page host, Cloudflare Workers, the only one since OFF-VERCEL OV9 (the default)
//   --root=<dir>             the release clone (default: this checkout's top level); one clean clone per channel
//   --dry-run                print every step and read the live gate; build, upload and alias nothing
//   --wait=<minutes>         check: how long to wait for the signed serial and /health (default 45)
//   --local-qa=<verdict.json> staging go-live (SQ7): the local QA verdict on the parent of the release commit.
//   --qa-out=<dir>           staging go-live writes one verdict.json here (J434). It runs the candidate and live QA itself.
//   --zone-entry-resume=<file>  rerun failed crossings from this live staging build's held phone smoke or resume a full tour.
//   --observer-proof=<file>  reuse an exact MS9 transition witness when verifying a staging build already live.
//   --qa=<verdict.json>      production needs staging go-live's verdict with the J451 phone tour for its exact build.
//   --content                retired (fix preview PV15): no channel publishes a content set; refused
//   --catalogue=<file>       preview build: bake this catalogue, the grid borrowed from staging (SHARD-AUTHORING SA35,
//                            src/scripts/preview-grid.ts); default test/pins/catalogue.json. Refused on staging and production
//   --zone-table=<file>      preview build: bake this zone table, staging's cook (fix preview PV2,
//                            src/scripts/page-release/zone-table.mjs build); check: HEAD every cooked object it names
//
//   node src/scripts/page-release.mjs --print-env <preview|staging|production|explore> [--root=<dir>] [--catalogue=<file>]
//                            print the channel's build environment for the root's HEAD (--catalogue on preview only),
//                            one sorted KEY=value a line, and run nothing (PAGE-SIZE PZ6: the three channels' builds
//                            differ only in named keys)
//
// The flow and its gates are src/scripts/page-release/flow.mjs; the page hosts are src/scripts/page-release/hosts/*.mjs.
// Phase results go to <root>/tmp/page-release/<channel>-<sha>.json, which the next phase reads.
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {CHANNELS, pinnedReleaseKey, RefusedError, buildEnv, runPhase} from './page-release/flow.mjs';
import {agentFetch} from './agent-requests.mjs';
import {missingProductionPacks, waitForPacks} from './page-release/production-packs.mjs';
import {workersHost} from './page-release/hosts/workers.mjs';
import {r2Packs} from './page-release/packs.mjs';
import {deployStaging} from './page-release/staging-deploy.mjs';
import {openReleaseRun} from './release-run.mjs';
import {phaseTable} from './page-release/phase-times.mjs';
import {npmFinal} from './page-release/npm-final.mjs';

/** SQ15: the staging-qa verdict.json, or why it could not be read. @param {string} file */
function readQa(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { return {problem: `${file}: ${error instanceof Error ? error.message : String(error)}`}; }
}

// The world-signing key reaches only the deployment publisher, never build tools or the host.
const signingKey = process.env.E7_RELEASE_SIGNING_KEY;
delete process.env.E7_RELEASE_SIGNING_KEY;
const releaseKey = pinnedReleaseKey(process.env.E7_RELEASE_PUBLIC_KEY);
const args = process.argv.slice(2);
const flag = (/** @type {string} */ name) => args.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
const value = (/** @type {string} */ name) => flag(name)?.split('=').slice(1).join('=');
/** Every channel is on Cloudflare Workers (OFF-VERCEL OV6 preview, OV7 staging, OV8 production), so `--host` has one value. */
const [channel, phaseList] = args.filter(arg => !arg.startsWith('--'));
const hostName = value('host') ?? 'workers';
if (flag('print-env') !== undefined) {
  const config = channel !== undefined && Object.hasOwn(CHANNELS, channel) ? Reflect.get(CHANNELS, channel) : undefined;
  const catalogue = value('catalogue');
  if (config === undefined || phaseList !== undefined || (catalogue !== undefined && !config.solo)) {
    console.error('usage: node src/scripts/page-release.mjs --print-env <preview|staging|production|explore> [--root=<dir>] [--catalogue=<file>, preview only]');
    process.exit(2);
  }
  const cwd = resolve(value('root') ?? '.');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const env = buildEnv(config, /** @type {any} */ ({build: head, releaseKey, ...(catalogue === undefined ? {} : {catalogue: resolve(catalogue)})}));
  for (const name of Object.keys(env).sort()) console.log(`${name}=${env[name]}`);
  process.exit(0);
}
if (channel === undefined || phaseList === undefined || hostName !== 'workers') {
  console.error('usage: node src/scripts/page-release.mjs <preview|staging|production|explore> <build|upload|check|go-live>[,...] [--host=workers] [--root=<dir>] [--dry-run] [--wait=<minutes>] [--local-qa=<verdict.json>] [--qa=<verdict.json>] [--catalogue=<file>] [--zone-table=<file>]');
  process.exit(2);
}
// Fix preview PV15: content sets are retired (PV17 stopped staging and production, PV13 preview); the old sets go
// through src/scripts/content-prune.mjs. test/page-content.test.ts holds this refusal.
if (flag('content') !== undefined) {
  console.error('page-release: --content is retired: no channel publishes a content set (fix preview PV15); zones come from the cook');
  process.exit(2);
}
// A build signs code-retention.json (FM7) after the whole page build; v0.1.96's production build ran minutes before it
// failed there on a missing key. Refuse before any work instead.
if (channel !== 'explore' && phaseList.split(',').includes('build') && flag('dry-run') === undefined && (signingKey === undefined || signingKey === '')) {
  console.error('page-release: a build signs code-retention.json; set E7_RELEASE_SIGNING_KEY="$(cat ~/.config/wildshard/e7-release-signing.pem)"');
  process.exit(2);
}
const git = (/** @type {string[]} */ argv, /** @type {string} */ cwd) => execFileSync('git', argv, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const root = resolve(value('root') ?? git(['rev-parse', '--show-toplevel'], process.cwd()));
const build = git(['rev-parse', 'HEAD'], root);
/** @type {string[]} */
const secrets = signingKey === undefined || signingKey === '' ? [] : [signingKey];
/** Cloudflare's token comes only from CLOUDFLARE_API_TOKEN (else wrangler's login). */
const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
if (cloudflareToken !== undefined && cloudflareToken !== '') secrets.push(cloudflareToken);
const redact = (/** @type {string} */ text) => secrets.reduce((out, secret) => secret === '' ? out : out.split(secret).join('<token>'), text);
const log = (/** @type {string} */ line) => console.log(redact(line));
const stateFile = join(root, 'tmp/page-release', `${channel}-${build}.json`);
const readState = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
/** @param {string} url */
async function fetch200(url) {
  const response = await fetch(url, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000)});
  if (response.status !== 200) throw new Error(`${url} answered ${response.status}`);
  return response;
}

const host = workersHost({token: () => cloudflareToken, log});

const ENGINE_REPO = 'project-wildshard/engine';
const cli = (/** @type {string} */ file, /** @type {string[]} */ argv, /** @type {string|undefined} */ input = undefined) =>
  execFileSync(file, argv, {cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : {input})}).trim();
/** QA 11-26 row 90: npm latest and the npm-publish.yml dispatch, through npm and gh. @type {import('./page-release/npm-final.mjs').NpmFinalDeps} */
const npmDeps = {
  latest: async () => { try { return cli('npm', ['view', '@wildshard/engine@latest', 'version', '--prefer-online']) || undefined; } catch { return undefined; } },
  existingRun: async tag => {
    const runs = JSON.parse(cli('gh', ['run', 'list', '-R', ENGINE_REPO, '--workflow', 'npm-publish.yml', '--event', 'workflow_dispatch', '--limit', '50', '--json', 'displayTitle,databaseId,conclusion']));
    return runs.find((/** @type {{displayTitle: string, conclusion: string}} */ run) => run.displayTitle === `npm latest ${tag}` && run.conclusion !== 'failure' && run.conclusion !== 'cancelled')?.databaseId;
  },
  dispatch: async tag => {
    const answer = cli('gh', ['workflow', 'run', 'npm-publish.yml', '-R', ENGINE_REPO, '--ref', 'main', '--json'], JSON.stringify({publish_final: tag}));
    const run = Number(/actions\/runs\/(\d+)/u.exec(answer)?.[1]);
    if (!Number.isSafeInteger(run) || run <= 0) throw new Error(`could not confirm the npm-publish dispatch for ${tag}`);
    return run;
  },
  watch: async run => {
    try { cli('gh', ['run', 'watch', String(run), '-R', ENGINE_REPO, '--exit-status', '--interval', '15']); } catch { /* the conclusion says why */ }
    return JSON.parse(cli('gh', ['run', 'view', String(run), '-R', ENGINE_REPO, '--json', 'conclusion'])).conclusion || 'unknown';
  },
  log, sleep: delay, now: () => Date.now(),
};

let phase = '';
/** @type {ReturnType<typeof openReleaseRun>|undefined} */
let scratch;
const phases = phaseList.split(',');
const bundled = channel === 'staging' && !flag('dry-run') && phases.includes('go-live');
const localQa = value('local-qa') === undefined ? undefined : readQa(resolve(value('local-qa') ?? ''));
const localQaSource = channel === 'staging' && phases.includes('go-live') ? git(['rev-parse', `${build}^`], root) : undefined;
const manifest = {
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  saveEpoch: JSON.parse(readFileSync(join(root, 'save-epoch.json'), 'utf8')).saveEpoch,
};
/** @param {import('./page-release/flow.mjs').Phase} step @param {import('./page-release/flow.mjs').QaVerdict} [generatedQa] */
async function run(step, generatedQa) {
    const qa = generatedQa ?? (value('qa') === undefined ? undefined : readQa(resolve(value('qa') ?? '')));
    const {refusals} = await runPhase(step, {
      root, channel: /** @type {any} */ (channel), build, host, releaseKey, codeRetention: channel !== 'explore',
      packs: r2Packs({log}),
      run: (file, argv, env) => {
        const signing = file === 'node' && (argv[2] === 'src/scripts/page-release/preview.mjs' || argv[0] === 'src/scripts/code-retention.mjs') && signingKey !== undefined
          ? {E7_RELEASE_SIGNING_KEY: signingKey, E7_RELEASE_PUBLIC_KEY: releaseKey} : {};
        execFileSync(file, argv, {cwd: root, env: {...process.env, ...env, ...signing}, stdio: 'inherit'});
      },
      fetchJSON: async url => (await fetch200(url)).json(),
      fetchText: async url => (await fetch200(url)).text(),
      // FR-A15: the public rooms hosts, marked by user agent only (a `?agent=` query reaches /health and reads 503); ALLOW_ROOMS_DOWN=1 lets a release that fixes an outage go on (J381).
      roomsStatus: async url => (await agentFetch(url, {cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20_000)})).status,
      allowRoomsDown: process.env.ALLOW_ROOMS_DOWN === '1',
      // FR-A17: production moves only when every advertised head has packs for this build.
      productionPacks: channel === 'production' ? missingProductionPacks : undefined,
      allowMissingPacks: process.env.ALLOW_MISSING_PACKS === '1',
      // QA 11-26 row 90 (J505): production go-live ends with npm latest at this tag (npm-publish.yml publish_final).
      npmFinal: channel === 'production' ? async tag => { await npmFinal(tag, npmDeps); } : undefined,
      readFile: path => readFileSync(path),
      state: {
        read: name => readState()[name],
        write: (name, entry) => {
          mkdirSync(join(root, 'tmp/page-release'), {recursive: true});
          writeFileSync(stateFile, `${JSON.stringify({...readState(), [name]: {...entry, at: new Date().toISOString()}}, null, 2)}\n`);
        },
      },
      git: {
        clean: () => git(['status', '--porcelain'], root) === '',
        head: () => build,
        remoteTag: tag => git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`, `refs/tags/${tag}`], root)
          .split('\n').map(line => line.split('\t')).sort(([, a], [, b]) => (b ?? '').length - (a ?? '').length)[0]?.[0] || undefined,
      },
      manifest,
      log, now: () => Date.now(), sleep: delay,
      dryRun: flag('dry-run') !== undefined,
      waitMs: Number(value('wait') ?? 45) * 60_000,
      ...(qa === undefined ? {} : {qa}),
      ...(localQaSource === undefined ? {} : {localQaSource}),
      ...(localQa === undefined ? {} : {localQa}),
      // the build runs in `root`, so a relative path is the caller's
      ...(value('catalogue') === undefined ? {} : {catalogue: resolve(value('catalogue') ?? '')}),
      ...(value('zone-table') === undefined ? {} : {zoneTable: resolve(value('zone-table') ?? '')}),
    });
    if (refusals.length > 0) log(`DRY-RUN ${channel} ${step}: ${refusals.length} gate(s) would refuse today`);
}
/** @type {import('./page-release/phase-times.mjs').PhaseTime[]} */
const phaseTimes = [];
try {
  scratch = openReleaseRun(root, 'page');
  for (phase of phases) {
    if (bundled && (phase === 'upload' || phase === 'check')) continue;
    const phaseStarted = Date.now();
    if (bundled && phase === 'go-live' && localQaSource !== undefined) {
      const proof = value('observer-proof'), resume = value('zone-entry-resume');
      await deployStaging({ root, build, release: `v${manifest.version}`, source: localQaSource,
        out: resolve(value('qa-out') ?? scratch.proof),
        ...(localQa === undefined ? {} : { localQa }), ...(proof === undefined ? {} : { observerProof: resolve(proof) }),
        ...(resume === undefined ? {} : { zoneEntryResume: resolve(resume) }),
        readState, get: async url => (await fetch200(url)).json(), phase: run, log,
        // FR-A19: staging QA starts only when every staging head has packs for this build (at most 45 min).
        waitPacks: () => waitForPacks(build, 'staging', {log}) });
    } else await run(/** @type {import('./page-release/flow.mjs').Phase} */ (phase));
    phaseTimes.push({phase, ms: Date.now() - phaseStarted});
  }
} catch (error) {
  // CLI and fetch errors can carry argv or headers: only redacted text leaves this process.
  console.error(redact(error instanceof RefusedError ? error.message : `${channel} ${phase} failed: ${error instanceof Error ? error.message : String(error)}`));
  console.error('the alias did not move unless an ALIAS MOVED line is above');
  process.exitCode = 1;
} finally {
  // fix-preview PV19: seconds per phase in the log and the job summary, amber over the release step's 180 s budget
  if (phaseTimes.length > 0) {
    const table = phaseTable(channel, phaseTimes);
    for (const line of table.lines) log(line);
    if (table.warning !== undefined) console.log(table.warning);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined && summary !== '') try { appendFileSync(summary, table.summary); } catch { /* a summary never fails the release */ }
  }
  scratch?.close();
}
