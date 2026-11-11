#!/usr/bin/env node
// The staging and production page release (meta OFF-VERCEL OV4). Runbook: docs/server-release.md "Page release".
//
//   node scripts/page-release.mjs <staging|production> <build|upload|check|go-live> [options]
//
//   --root=<dir>             the release clone (default: this checkout's top level); one clean clone per channel
//   --dry-run                print every step and read the live gate; build, upload and alias nothing
//   --wait=<minutes>         check: how long to wait for the signed serial and /health (default 45)
//   --after-staging-proofs   production go-live: the strict staging proofs passed on this exact build
//
// The flow and its gates are scripts/page-release/flow.mjs; the page host is scripts/page-release/hosts/vercel.mjs.
// Phase results go to <root>/tmp/page-release/<channel>-<sha>.json, which the next phase reads.
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {RefusedError, runPhase} from './page-release/flow.mjs';
import {vercelHost, vercelToken} from './page-release/hosts/vercel.mjs';
import {r2Packs} from './page-release/packs.mjs';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ name) => args.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
const value = (/** @type {string} */ name) => flag(name)?.split('=').slice(1).join('=');
const [channel, phase] = args.filter(arg => !arg.startsWith('--'));
if (channel === undefined || phase === undefined) {
  console.error('usage: node scripts/page-release.mjs <staging|production> <build|upload|check|go-live> [--root=<dir>] [--dry-run] [--wait=<minutes>] [--after-staging-proofs]');
  process.exit(2);
}
const git = (/** @type {string[]} */ argv, /** @type {string} */ cwd) => execFileSync('git', argv, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const root = resolve(value('root') ?? git(['rev-parse', '--show-toplevel'], process.cwd()));
const build = git(['rev-parse', 'HEAD'], root);
/** @type {string[]} */
const secrets = [];
let token = '';
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

try {
  const {refusals} = await runPhase(/** @type {any} */ (phase), {
    root, channel: /** @type {any} */ (channel), build,
    host: vercelHost({token: () => { if (token === '') { token = vercelToken(); secrets.push(token); } return token; }}),
    packs: r2Packs({log}),
    run: (file, argv, env) => execFileSync(file, argv, {cwd: root, env: {...process.env, ...env}, stdio: 'inherit'}),
    fetchJSON: async url => (await fetch200(url)).json(),
    fetchText: async url => (await fetch200(url)).text(),
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
    manifest: {
      version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      saveEpoch: JSON.parse(readFileSync(join(root, 'save-epoch.json'), 'utf8')).saveEpoch,
    },
    log, now: () => Date.now(), sleep: delay,
    dryRun: flag('dry-run') !== undefined,
    waitMs: Number(value('wait') ?? 45) * 60_000,
    afterStagingProofs: flag('after-staging-proofs') !== undefined,
  });
  if (refusals.length > 0) log(`DRY-RUN ${channel} ${phase}: ${refusals.length} gate(s) would refuse today`);
} catch (error) {
  // CLI and fetch errors can carry argv or headers: only redacted text leaves this process.
  console.error(redact(error instanceof RefusedError ? error.message : `${channel} ${phase} failed: ${error instanceof Error ? error.message : String(error)}`));
  console.error('alias not moved unless a PASS line above says so');
  process.exitCode = 1;
}
