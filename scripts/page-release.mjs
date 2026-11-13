#!/usr/bin/env node
// The preview, staging and production page release (meta OFF-VERCEL OV4). Runbook: docs/server-release.md "Page release".
//
//   node scripts/page-release.mjs <preview|staging|production> <phase>[,<phase>...] [options]
//
//   phases: build, upload, check, go-live, in that order; a comma list runs them one after another and stops at the first
//   failure (preview.yml: `preview build,upload,check,go-live`)
//   --host=workers           the page host, Cloudflare Workers, the only one since OFF-VERCEL OV9 (the default)
//   --root=<dir>             the release clone (default: this checkout's top level); one clean clone per channel
//   --dry-run                print every step and read the live gate; build, upload and alias nothing
//   --wait=<minutes>         check: how long to wait for the signed serial and /health (default 45)
//   --after-staging-proofs   production go-live: the strict staging proofs passed on this exact build
//   --content                upload: publish the page's content set to packs.wildshard.io first (PAGE-SIZE PZ2,
//                            page-release/content.mjs); off until PZ4 and PZ6 stamp contentBase into the page
//   --catalogue=<file>       preview build: bake this catalogue, the grid borrowed from staging (SHARD-AUTHORING SA35,
//                            scripts/preview-grid.ts); default test/pins/catalogue.json. Refused on staging and production
//
//   node scripts/page-release.mjs --print-env <preview|staging|production> [--root=<dir>] [--catalogue=<file>]
//                            print the channel's build environment for the root's HEAD (--catalogue on preview only),
//                            one sorted KEY=value a line, and run nothing (PAGE-SIZE PZ6: the three channels' builds
//                            differ only in named keys)
//
// The flow and its gates are scripts/page-release/flow.mjs; the page hosts are scripts/page-release/hosts/*.mjs.
// Phase results go to <root>/tmp/page-release/<channel>-<sha>.json, which the next phase reads.
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {CHANNELS, RefusedError, buildEnv, runPhase} from './page-release/flow.mjs';
import {workersHost} from './page-release/hosts/workers.mjs';
import {r2Packs} from './page-release/packs.mjs';
import {publishContent, r2Content} from './page-release/content.mjs';

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
    console.error('usage: node scripts/page-release.mjs --print-env <preview|staging|production> [--root=<dir>] [--catalogue=<file>, preview only]');
    process.exit(2);
  }
  const cwd = resolve(value('root') ?? '.');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const env = buildEnv(config, /** @type {any} */ ({build: head, ...(catalogue === undefined ? {} : {catalogue: resolve(catalogue)})}));
  for (const name of Object.keys(env).sort()) console.log(`${name}=${env[name]}`);
  process.exit(0);
}
if (channel === undefined || phaseList === undefined || hostName !== 'workers') {
  console.error('usage: node scripts/page-release.mjs <preview|staging|production> <build|upload|check|go-live>[,...] [--host=workers] [--root=<dir>] [--dry-run] [--wait=<minutes>] [--after-staging-proofs] [--content] [--catalogue=<file>]');
  process.exit(2);
}
const git = (/** @type {string[]} */ argv, /** @type {string} */ cwd) => execFileSync('git', argv, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const root = resolve(value('root') ?? git(['rev-parse', '--show-toplevel'], process.cwd()));
const build = git(['rev-parse', 'HEAD'], root);
/** @type {string[]} */
const secrets = [];
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

let phase = '';
try {
  for (phase of phaseList.split(',')) {
    const {refusals} = await runPhase(/** @type {any} */ (phase), {
      root, channel: /** @type {any} */ (channel), build, host,
      packs: r2Packs({log}),
      ...(flag('content') === undefined ? {} : {content: {
        publish: ({dir, cors, dryRun}) => publishContent({dir, origin: cors, dryRun, log,
          scratch: join(root, 'tmp/page-release/content'), store: r2Content({root, scratch: join(root, 'tmp/page-release/content'), token: cloudflareToken})}),
      }}),
      run: (file, argv, env) => { execFileSync(file, argv, {cwd: root, env: {...process.env, ...env}, stdio: 'inherit'}); },
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
      // the build runs in `root`, so a relative path is the caller's
      ...(value('catalogue') === undefined ? {} : {catalogue: resolve(value('catalogue') ?? '')}),
    });
    if (refusals.length > 0) log(`DRY-RUN ${channel} ${phase}: ${refusals.length} gate(s) would refuse today`);
  }
} catch (error) {
  // CLI and fetch errors can carry argv or headers: only redacted text leaves this process.
  console.error(redact(error instanceof RefusedError ? error.message : `${channel} ${phase} failed: ${error instanceof Error ? error.message : String(error)}`));
  console.error('the alias did not move unless an ALIAS MOVED line is above');
  process.exitCode = 1;
}
