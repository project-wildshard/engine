// The Cloudflare Workers page host for scripts/page-release.mjs (meta OFF-VERCEL OV4, J272, J274). Three Workers from
// one config, pages/wrangler.jsonc (OV1): production is the top level and is named `--env ''` out loud (wrangler warns
// otherwise), staging and preview are `--env staging` and `--env preview`. The asset directory is dist/ (OV3).
//
//   prepare          the config names this channel's Worker
//   package          source maps to Sentry, then stripped from dist/; dist/ within the Workers asset limits
//   upload           `wrangler versions upload --env <c> --tag <sha> --message v<version>`: a version, never deployed
//   deployedDigests  `wrangler versions view <id> --json` must carry this build's tag, then the SHA-256 of each
//                    document's bytes as the version's own preview URL serves them
//   goLive           `wrangler versions deploy <id>@100% --env <c> --yes`: the alias move. No gradual deploys (J274).
//
// The token is CLOUDFLARE_API_TOKEN from the environment (GitHub Actions), else wrangler's own login (the MacBook lane
// for production, J274). It reaches wrangler only through the inherited environment: never argv, never printed. Every
// child's output is captured and printed with the token replaced.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {assertAssetLimits, describeAssetLimits} from '../../app-build/assetLimits.mjs';
import {CLOUDFLARE_ACCOUNT} from '../packs.mjs';
import {runRedacted} from '../redact.mjs';

export const CONFIG = 'pages/wrangler.jsonc';
/** @type {Record<'preview'|'staging'|'production', {env: string, worker: string}>} */
export const WORKERS = {
  preview: {env: 'preview', worker: 'wildshard-play-preview'},
  staging: {env: 'staging', worker: 'wildshard-play-staging'},
  production: {env: '', worker: 'wildshard-play'},
};
const MAP = /\.map(?:\.(?:gz|br))?$/u;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * A version's preview URL is `https://<first 8 of its id>-<worker>.<account subdomain>.workers.dev`.
 * @param {string} url @param {string} id @param {string} worker
 */
export function isVersionUrl(url, id, worker) {
  // Worker names and version ids are [a-z0-9-] only, so neither needs escaping inside the pattern.
  if (!/^[a-z0-9-]+$/u.test(worker) || !VERSION_ID.test(id)) return false;
  return new RegExp(`^https://${id.slice(0, 8)}-${worker}\\.[a-z0-9-]+\\.workers\\.dev$`, 'u').test(url);
}

/**
 * Delete every source map under `directory` (they went to Sentry first); returns how many.
 * @param {string} directory
 */
export function stripSourceMaps(directory) {
  let removed = 0;
  /** @param {string} folder */
  const walk = folder => {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (MAP.test(entry.name)) { rmSync(path); removed++; }
    }
  };
  walk(directory);
  return removed;
}

/**
 * @param {{token: () => string | undefined, exec?: typeof runRedacted, fetch?: typeof fetch, log?: (line: string) => void}} options
 * @returns {import('../flow.mjs').PageHost}
 */
export function workersHost({token, exec = runRedacted, fetch: get = fetch, log = line => console.log(line)}) {
  /** @param {import('../flow.mjs').HostContext} context */
  const worker = context => {
    const found = Object.hasOwn(WORKERS, context.channel.channel) ? WORKERS[context.channel.channel] : undefined;
    if (found === undefined) throw new Error(`no Worker for channel ${context.channel.channel}`);
    return found;
  };
  const secrets = () => { const value = token(); return value === undefined || value === '' ? [] : [value]; };
  /** @param {Record<string, string>} [extra] */
  const env = (extra = {}) => ({...process.env, CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT, WRANGLER_SEND_METRICS: 'false', ...extra});
  /** @param {import('../flow.mjs').HostContext} context @param {string[]} args @param {Record<string, string>} [extra] */
  const wrangler = (context, args, extra) => exec(join(context.root, 'node_modules/.bin/wrangler'),
    [...args, '--config', CONFIG, '--env', worker(context).env], {cwd: context.root, env: env(extra)}, secrets());
  /** @param {import('../flow.mjs').HostContext} context */
  const envFlag = context => `--env ${worker(context).env === '' ? "''" : worker(context).env}`;
  const via = () => (token() ?? '') === '' ? "wrangler's own login" : 'CLOUDFLARE_API_TOKEN=<token> from the environment';
  return {
    name: 'workers',
    buildEnv: () => ({}),
    outputDir: context => join(context.root, 'dist'),
    prepare(context) {
      const file = join(context.root, CONFIG);
      if (!existsSync(file)) throw new Error(`${CONFIG} is missing (OFF-VERCEL OV1)`);
      const {worker: name} = worker(context);
      if (!readFileSync(file, 'utf8').includes(`"name": "${name}"`)) throw new Error(`${CONFIG} does not name the Worker ${name}`);
      return Promise.resolve();
    },
    package(context) {
      const dist = join(context.root, 'dist');
      // SENTRY-TRIAGE S5: the hidden maps go to Sentry, never to the CDN. A Sentry outage never stops a release.
      try {
        process.stdout.write(exec('node', ['scripts/sentry-maps.mjs', 'dist', '--environment', context.channel.channel], {cwd: context.root, env: env()}, secrets()));
      } catch (error) {
        log(`warning: source maps not sent to Sentry (${error instanceof Error ? error.message : String(error)}); stripping them anyway`);
      }
      log(`stripped ${stripSourceMaps(dist)} source maps from dist/`);
      log(`dist/: ${describeAssetLimits(assertAssetLimits(dist))}`);
      return Promise.resolve();
    },
    upload(context) {
      const {worker: name} = worker(context);
      const outputFile = join(context.root, 'tmp/page-release', `wrangler-${context.channel.channel}-${context.build}.ndjson`);
      mkdirSync(join(context.root, 'tmp/page-release'), {recursive: true});
      rmSync(outputFile, {force: true});
      process.stdout.write(wrangler(context, ['versions', 'upload', '--tag', context.build, '--message', `v${context.version}`], {WRANGLER_OUTPUT_FILE_PATH: outputFile}));
      const entries = existsSync(outputFile) ? readFileSync(outputFile, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line)) : [];
      const uploaded = entries.findLast(entry => entry?.type === 'version-upload');
      if (uploaded === undefined) throw new Error('wrangler versions upload wrote no version-upload entry');
      const id = String(uploaded.version_id);
      const url = String(uploaded.preview_url ?? '');
      if (uploaded.worker_name !== name) throw new Error(`wrangler uploaded to ${uploaded.worker_name}, not ${name}`);
      if (!VERSION_ID.test(id)) throw new Error(`wrangler reported version id ${id}`);
      if (!isVersionUrl(url, id, name)) throw new Error(`version ${id} has no preview URL on ${name} (got '${url}'; preview_urls must stay on)`);
      return Promise.resolve({id, url});
    },
    async deployedDigests(context, names) {
      const {id, url} = context.deployment;
      const {worker: name} = worker(context);
      if (!VERSION_ID.test(id) || !isVersionUrl(url, id, name)) throw new Error(`${id} at ${url} is not a version of ${name}`);
      const view = wrangler(context, ['versions', 'view', id, '--json']);
      const version = JSON.parse(view.slice(view.indexOf('{')));
      if (version.id !== id) throw new Error(`wrangler versions view answered ${version.id}, not ${id}`);
      const tag = version.annotations?.['workers/tag'];
      if (tag !== context.build) throw new Error(`version ${id} is tagged ${tag ?? 'nothing'}, not ${context.build}`);
      /** @type {Map<string, import('../flow.mjs').Digest>} */
      const digests = new Map();
      for (const document of names) {
        const response = await get(`${url}/${document}`, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
        if (response.status !== 200) throw new Error(`${url}/${document} answered ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        digests.set(document, {algorithm: 'sha256', digest: createHash('sha256').update(bytes).digest('hex')});
      }
      return digests;
    },
    goLive(context) {
      process.stdout.write(wrangler(context, ['versions', 'deploy', `${context.deployment.id}@100%`, '--yes', '--message', `v${context.version} ${context.build.slice(0, 7)}`]));
      return Promise.resolve();
    },
    describe(step, context) {
      const {worker: name} = worker(context);
      const w = `node_modules/.bin/wrangler --config ${CONFIG} ${envFlag(context)} (${name}, account ${CLOUDFLARE_ACCOUNT}, ${via()})`;
      const id = context.deployment?.id ?? '<version id>';
      return {
        prepare: [`check ${CONFIG} names ${name}`],
        package: [`run node scripts/sentry-maps.mjs dist --environment ${context.channel.channel}`, 'strip source maps from dist/', 'check dist/ is within the Workers asset limits (90,000 files, 25 MiB each)'],
        upload: [`run wrangler versions upload --tag ${context.build} --message v${context.version} with ${w}: a version only, nothing deployed`],
        deployedDigests: [`run wrangler versions view ${id} --json with ${w}: tag must be ${context.build}`, `GET ${context.deployment?.url ?? '<version url>'}/<document>: SHA-256 must equal the local file`],
        goLive: [`run wrangler versions deploy ${id}@100% --yes with ${w} (alias ${context.channel.origin})`],
      }[step];
    },
  };
}
