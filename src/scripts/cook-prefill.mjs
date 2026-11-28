// Meta QA 11-26 row 92 (opus-ship2, 2026-11-28): a release whose cook hash moved needs every pinned zone's index at that hash
// before its staging page can build, but the staging cook only runs at go-live. v0.1.103's train held at local QA on "No cooked
// index for brasscap-mesa" (cook 1.21.0, 0525a4ee, same output as 9042bac8). This is the train's step before local QA: it reads
// each pin's index at this tree's cook from the cooked host, and cooks only the missing ones into `wildshard-cooked` with the cook
// worker (a same-output declaration carries the donor's cook after a proof cook). Without the cook credentials it refuses and
// names the command. Replaces the hand-run prefill scripts (PV25, PV26).
// CLI: node --env-file=~/.config/wildshard/cook.env --import ./src/scripts/bake-loader.mjs src/scripts/cook-prefill.mjs
//        [--check] [--scratch=<dir>]
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {COOKED_ORIGIN, cookedIndexKey} from '../shared/game/shardfile/cookedPackPaths.ts';

/** @typedef {{slug: string, shardVersion: string, hash: string}} Pin */
/** @typedef {{cookVersion: string, cookHash: string, sameOutputFrom?: string}} Recipe */

export const PREFILL_COMMAND = 'node --env-file=$HOME/.config/wildshard/cook.env --import ./src/scripts/bake-loader.mjs src/scripts/cook-prefill.mjs';

/** The index key each pin needs at `recipe`. @param {readonly Pin[]} pins @param {Recipe} recipe */
export function indexKeys(pins, recipe) {
  return pins.map(pin => ({pin, key: cookedIndexKey({slug: pin.slug, shardVersion: pin.shardVersion, cookVersion: recipe.cookVersion, cookHash: recipe.cookHash})}));
}

/** The pins whose index the cooked host does not hold. `status` answers a key's HTTP status.
 * @param {readonly Pin[]} pins @param {Recipe} recipe @param {(key: string) => Promise<number>} status @returns {Promise<Pin[]>} */
export async function missingCooks(pins, recipe, status) {
  const rows = await Promise.all(indexKeys(pins, recipe).map(async ({pin, key}) => {
    const code = await status(key);
    if (code !== 200 && code !== 404) throw new Error(`${COOKED_ORIGIN}${key} answered ${code}`);
    return code === 404 ? pin : undefined;
  }));
  return rows.filter(pin => pin !== undefined);
}

/** Why the prefill cannot cook, or undefined. @param {readonly Pin[]} missing @param {Recipe} recipe @param {NodeJS.ProcessEnv} env */
export function prefillRefusal(missing, recipe, env) {
  if (missing.length === 0) return undefined;
  const absent = ['R2_ACCOUNT_ID', 'R2_COOKED_ACCESS_KEY_ID', 'R2_COOKED_SECRET_ACCESS_KEY'].filter(name => !env[name]);
  if (absent.length === 0) return undefined;
  return `${missing.length} zone(s) have no index at cook ${recipe.cookVersion} ${recipe.cookHash.slice(0, 12)} (${missing.map(pin => pin.slug).join(', ')}),`
    + ` and ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} unset: run ${PREFILL_COMMAND} from this tree`;
}

/** @param {string} root @param {{check?: boolean, scratch?: string, log?: (line: string) => void, env?: NodeJS.ProcessEnv}} [options] */
export async function cookPrefill(root, {check = false, scratch, log = console.log, env = process.env} = {}) {
  const mod = (/** @type {string} */ path) => import(pathToFileURL(resolve(root, path)).href);
  const tracked = (/** @type {string} */ path) => JSON.parse(execFileSync('git', ['show', `HEAD:${path}`], {cwd: root, encoding: 'utf8'}));
  const {api, shards} = /** @type {{api: string, shards: Pin[]}} */ (tracked('test/pins/shardfiles.json'));
  const recipe = /** @type {Recipe} */ (tracked('src/cook/game/cook-version.json'));
  const {agentFetch} = await mod('src/scripts/agent-requests.mjs');
  const status = async (/** @type {string} */ key) => {
    const response = await agentFetch(`${COOKED_ORIGIN}${key}`, {method: 'HEAD', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
    return response.status;
  };
  const missing = await missingCooks(shards, recipe, status);
  const at = `cook ${recipe.cookVersion} ${recipe.cookHash.slice(0, 12)}`;
  log(`cook prefill: ${shards.length - missing.length} of ${shards.length} pinned zones have an index at ${at}`);
  if (missing.length === 0) return {cooked: []};
  if (check) throw new Error(`${missing.length} zone(s) have no index at ${at}: ${missing.map(pin => pin.slug).join(', ')}`);
  const refusal = prefillRefusal(missing, recipe, env);
  if (refusal !== undefined) throw new Error(refusal);
  const {cookHash} = await mod('src/scripts/cookHash.ts');
  if (cookHash(root).cookHash !== recipe.cookHash) throw new Error('This tree\'s cook inputs do not match its cook-version.json; prefill from a clean clone');
  const {apiSource, createCookWorker, DEFAULT_LIMITS, uncookedLiveRefusal} = await mod('src/cook/game/cookWorker.ts');
  const {r2Store} = await mod('src/cook/game/packStore.ts');
  const {rendererRevision} = await mod('src/scripts/renderer-revision.mjs');
  const {shardfileValidationRevision} = await mod('src/scripts/shardfile-validation-revision.mjs');
  const build = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  const upstream = apiSource(api, agentFetch, undefined, true);
  const stages = ['live', 'staging', 'preview'];
  /** @type {{slug: string, hash: string, shardVersion?: string}[][]} */
  const heads = await Promise.all(stages.map(stage => upstream.heads(stage)));
  const copies = heads.map(rows => rows.filter(head => missing.some(pin => pin.slug === head.slug && pin.hash === head.hash && pin.shardVersion === head.shardVersion)));
  const unheld = missing.filter(pin => !copies.flat().some(head => head.slug === pin.slug && head.hash === pin.hash));
  if (unheld.length > 0) throw new Error(`No live, staging or preview head is the pin for ${unheld.map(pin => pin.slug).join(', ')}`);
  const store = r2Store({endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: 'wildshard-cooked',
    accessKeyId: env.R2_COOKED_ACCESS_KEY_ID, secretAccessKey: env.R2_COOKED_SECRET_ACCESS_KEY});
  const work = scratch === undefined ? mkdtempSync(join(tmpdir(), 'cook-prefill-')) : resolve(scratch);
  try {
    log(`cook prefill: cooking ${missing.map(pin => pin.slug).join(', ')} at ${at}${recipe.sameOutputFrom === undefined ? '' : ` (same output as ${recipe.sameOutputFrom.slice(0, 12)})`}`);
    const worker = createCookWorker({
      build, store, source: {...upstream, heads: async (/** @type {string} */ stage) => copies[stages.indexOf(stage)] ?? []},
      scratch: join(work, 'jobs'), serverPacks: join(work, 'server'), log,
      cook: recipe.cookHash, validator: shardfileValidationRevision(root),
      versioned: {cookVersion: recipe.cookVersion, cookHash: recipe.cookHash, store, ...(recipe.sameOutputFrom === undefined ? {} : {sameOutputFrom: recipe.sameOutputFrom})},
      launcher: {root, renderer: rendererRevision(root), execPath: process.execPath, loader: resolve(root, 'src/scripts/bake-loader.mjs'),
        script: resolve(root, 'src/scripts/cook-job.mjs'), wrap: [], limits: {...DEFAULT_LIMITS, cpuSlots: 4}},
    });
    const proof = await worker.recook(stages);
    const failed = uncookedLiveRefusal(build, proof);
    if (failed) throw new Error(failed);
    const still = await missingCooks(shards, recipe, status);
    if (still.length > 0) throw new Error(`After the cook, ${still.length} zone(s) still have no index at ${at}: ${still.map(pin => pin.slug).join(', ')}`);
    log(`cook prefill: ${shards.length} of ${shards.length} pinned zones have an index at ${at}`);
    return {cooked: missing.map(pin => pin.slug)};
  } finally {
    if (scratch === undefined) rmSync(work, {recursive: true, force: true});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const {values} = parseArgs({options: {check: {type: 'boolean'}, scratch: {type: 'string'}}});
  await cookPrefill(process.cwd(), {check: values.check === true, ...(values.scratch === undefined ? {} : {scratch: values.scratch})});
}
