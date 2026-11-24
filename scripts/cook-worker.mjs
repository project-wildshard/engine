#!/usr/bin/env node
// C4 (J28, J29, J30): the cook worker.
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs serve     notify endpoint; lists the catalogue at boot, then
//     polls it every COOK_POLL_SECONDS (45; 30 to 60) and cooks each new upload (SHARD-COMPAT SP6, J175)
//     (production, preview and staging heads: MS2.4, a new author's `upload --channel staging` is a staging head only)
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs recook    every live and preview head, then exit; a deploy's step
//     (SHARD-COMPAT SP1b-T: the record pass first, when the host keeps sidecars and names a recorder)
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs record    the record pass alone, then exit
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs bake <dist> <origin>   the live heads this build cooked, onto its built client
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs gc <build>...   keep those builds and every build a channel's
//     live deploy-chunks.json names (PAGE-SIZE PZ5: 5 a channel), delete the rest, print usage
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs reclaim [<build>...]   J505's protected collection: keep those builds,
//     every build a channel carries and every live/staging/preview head's index from any build; a publish runs it under 15%
//     headroom and the serve loop nightly
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs report    print usage against the budget (J89)
// Environment: WILDSHARD_API_URL, WILDSHARD_BUILD; R2_ACCOUNT_ID, R2_BUCKET_PACKS, R2_PACKS_ACCESS_KEY_ID,
// R2_PACKS_SECRET_ACCESS_KEY, or COOK_STORE_DIR for a folder; COOK_NOTIFY_TOKEN; COOK_PORT (8792; 8790 and 8791 are the game's), COOK_HOST (127.0.0.1);
// COOK_SERVER_PACKS, COOK_SCRATCH; COOK_SECONDS, COOK_MEMORY_MB, COOK_HEAP_MB, COOK_MAX_SHARDFILE_BYTES; COOK_JOB_WRAP, a JSON array the host puts
// before each job to take its network away (see the wildshard-cook unit in scripts/vps/rebuild.sh). SP1b-T: COOK_SIDECARS, the
// folder of cook preparation sidecars every job reads; COOK_RECORDER (the `wildshard` command, a JSON array),
// COOK_PREPARATION_CLIENT, COOK_RECORD_CANARY, COOK_RECORD_WRAP, COOK_RECORD_SECONDS, COOK_RECORD_ACCEPTED for the record pass.
import { agentFetch as fetch } from './agent-requests.mjs';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { apiSource, bootCook, collectGarbage, createCookWorker, DEFAULT_LIMITS, notifyServer, pollCatalogue, PACK_BUDGET_BYTES, POLL_EVERY_MS, reclaimPacks, storeUsage, uncookedLiveRefusal } = await import('../src/cook/game/cookWorker.ts');
const {activationDelivery, gameActivationClient, cookApi, pendingSource, uploadDelivery, VerdictOutbox} = await import('../src/cook/game/uploadTransport.ts');
const { MAX_SHARDFILE_BYTES } = await import('@wildshard/format/uploadCaps');
const { cookSidecars, recordPass } = await import('../src/cook/game/recordPass.ts');
const { addStoredShards } = await import('./app-build/catalogue.ts');
const { refreshServiceWorker } = await import('./app-build/serviceWorker.ts');
const { folderStore, r2Store } = await import('../src/cook/game/packStore.ts');
const { rendererRevision } = await import('./renderer-revision.mjs');
const { shardfileValidationRevision } = await import('./shardfile-validation-revision.mjs');
const { liveDeployBuilds } = await import('./app-build/previousDeploy.mjs');

const env = process.env;
/** @param {string} name */
const need = name => { const value = env[name]; if (value === undefined || value === '') throw new Error(`cook-worker needs ${name}`); return value; };
// An env file's blank row is unset: a blank COOK_STORE_DIR means R2, never a folder at the working directory.
const store = env.COOK_STORE_DIR === undefined || env.COOK_STORE_DIR === ''
  ? r2Store({ endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`, bucket: need('R2_BUCKET_PACKS'), accessKeyId: need('R2_PACKS_ACCESS_KEY_ID'), secretAccessKey: need('R2_PACKS_SECRET_ACCESS_KEY') })
  : folderStore(env.COOK_STORE_DIR);
const root = fileURLToPath(new URL('..', import.meta.url));
const maxBytes = Number(env.COOK_MAX_SHARDFILE_BYTES ?? MAX_SHARDFILE_BYTES);
/** J262: the jobs can't compute it under `--permission`; a host that can't either cooks every preparation as stale. */
const renderer = (() => { try { return rendererRevision(root); } catch { return undefined; } })();
/** SA48: the validator each job validates with; an index stamped with it lets a page of the same validator admit the shard. */
const validator = (() => { try { return shardfileValidationRevision(root); } catch { return undefined; } })();
/** SHARD-COMPAT SP7, the recook rule: a build whose cook revision is unchanged carries another build's index for the same
 *  bytes instead of cooking them again. A host that can't compute it cooks every head, as before. */
let cookRevisionError = '';
const cookRevisionId = await (async () => { try { return (await import('./cook-revision.ts')).cookRevision(root).revision; } catch (error) { cookRevisionError = error instanceof Error ? error.message : String(error); return undefined; } })();
if (cookRevisionId === undefined) console.warn(`cook-worker: no cook revision (${cookRevisionError}), so every head cooks again for this build (SP7)`);
else console.log(`cook-worker: cook revision ${cookRevisionId}`);
if (validator === undefined) console.warn('cook-worker: no shardfile validator revision, so no index carries a verdict and no page enters a placed slug from it (SA48)');
const uploadApi = env.COOK_SIGNING_KEY === undefined || env.COOK_SIGNING_KEY === '' ? undefined : cookApi(need('WILDSHARD_API_URL'), env.COOK_SIGNING_KEY, fetch, Date.now, maxBytes);
const publicSource = apiSource(env.WILDSHARD_API_URL ?? 'https://api.wildshard.io', fetch, maxBytes);
const privateSource = uploadApi === undefined ? undefined : pendingSource(uploadApi, publicSource);
const uploadSource = privateSource ?? publicSource;
const [command, ...rest] = process.argv.slice(2);
const sidecars = cookSidecars(env), scratch = resolve(env.COOK_SCRATCH ?? 'tmp/cook/scratch');
/** SP1b-T: record a sidecar for every stale head before a recook cooks it, so a render change ends `prepared by cook`. */
const record = () => recordPass(env, renderer, scratch, uploadSource, line => { console.log(line); });
const packBudget = Number(env.COOK_BUDGET_BYTES ?? PACK_BUDGET_BYTES);
/** J505: the protected collection (reclaimPacks): this build, every build a channel carries, and every live, staging and
 *  preview head's index from any build. A publish runs it under 15% headroom (createCookWorker's `reclaim`), and the serve
 *  loop runs it nightly, so a full pack store never waits on a hand GC again (codex-ms ran it by hand on 2026-11-23). */
const reclaim = async () => {
  const channels = await liveDeployBuilds();
  const builds = [...new Set([need('WILDSHARD_BUILD'), ...rest.filter(arg => !arg.startsWith('-')), ...channels.flatMap(row => row.builds)])];
  /** @type {Set<string>} */ const heads = new Set();
  for (const stage of /** @type {const} */ (['live', 'staging', 'preview'])) for (const row of await publicSource.heads(stage)) heads.add(row.hash);
  if (privateSource !== undefined) for (const stage of /** @type {const} */ (['staging', 'preview'])) for (const row of await privateSource.heads(stage)) heads.add(row.hash);
  const report = await reclaimPacks(store, {builds, heads}, packBudget, Date.now());
  console.log(`pack store reclaim: freed ${report.freedBytes} B in ${report.deleted} objects; kept ${builds.length} builds and ${heads.size} heads; ${report.usage.bytes} of ${packBudget} B used`);
  return report;
};
const worker = () => createCookWorker({
  build: need('WILDSHARD_BUILD'), store, source: uploadSource, log: line => { console.log(line); }, reclaim,
  serverPacks: resolve(env.COOK_SERVER_PACKS ?? 'tmp/cook/server'), scratch,
  ...(validator === undefined ? {} : { validator }), ...(cookRevisionId === undefined ? {} : { cook: cookRevisionId }),
  launcher: {
    root, execPath: process.execPath, loader: fileURLToPath(new URL('bake-loader.mjs', import.meta.url)), script: fileURLToPath(new URL('cook-job.mjs', import.meta.url)),
    wrap: JSON.parse(env.COOK_JOB_WRAP ?? '[]'), ...(renderer === undefined ? {} : { renderer }), ...(sidecars === undefined ? {} : { sidecars }),
    limits: { seconds: Number(env.COOK_SECONDS ?? DEFAULT_LIMITS.seconds), memoryMB: Number(env.COOK_MEMORY_MB ?? DEFAULT_LIMITS.memoryMB), heapMB: Number(env.COOK_HEAP_MB ?? DEFAULT_LIMITS.heapMB), maxBytes,
      // The service's AllowedCPUs already constrains the cook. Pass that grant so its encoders reserve one core for coordination.
      ...(command === 'serve' ? {cpuSlots: availableParallelism()} : {}) },
  },
});

if (command === 'serve') {
  const cook = worker(), port = Number(env.COOK_PORT ?? 8792), host = env.COOK_HOST ?? '127.0.0.1';
  notifyServer(cook, need('COOK_NOTIFY_TOKEN')).listen(port, host, () => { console.log(`cook worker on ${host}:${port}`); });
  // SP6 (J175): the API sends this box no notice, so the cook reads the catalogue on a clock, outbound. opus-ss16g: from the
  // start, beside the boot recook (J30), and a new upload cooks ahead of the known heads that recook still owes.
  const seconds = Number(env.COOK_POLL_SECONDS ?? POLL_EVERY_MS / 1000);
  const everyMs = Math.min(60, Math.max(30, Number.isFinite(seconds) ? seconds : POLL_EVERY_MS / 1000)) * 1000;
  console.log(`cook worker polls the catalogue every ${everyMs / 1000} s`);
  bootCook(cook, { everyMs, log: line => { console.log(line); } });
  // J505: the nightly protected collection (a publish also runs it under 15% headroom)
  setInterval(() => { reclaim().catch(error => { console.warn(`pack store reclaim failed: ${error instanceof Error ? error.message : String(error)}`); }); }, 24 * 3600_000).unref();
  if (uploadApi !== undefined && privateSource !== undefined) {
    // The initial rollout is staging only; production keeps its existing upload law.
    need('COOK_STAGING_ACTIVATION_URL'); need('COOK_STAGING_ACTIVATION_TOKEN');
    const delivery = uploadDelivery({api: uploadApi, source: privateSource, worker: cook, build: need('WILDSHARD_BUILD'), outbox: new VerdictOutbox(resolve(need('COOK_OUTBOX'))), log: line => {console.log(line);}});
    // Independent discovery: public recooks cannot hold the private pending feed.
    pollCatalogue({sweep: async () => {await delivery.sweep(); return [];}}, {everyMs, log: line => {console.log(line);}});
    /** @type {Partial<Record<'staging'|'production', {url:string, token:string}>>} */
    const receivers = {};
    for (const channel of /** @type {const} */ (['staging', 'production'])) {
      const prefix = `COOK_${channel.toUpperCase()}_ACTIVATION`;
      if (env[`${prefix}_URL`] !== undefined && env[`${prefix}_URL`] !== '') receivers[channel] = {url: need(`${prefix}_URL`), token: need(`${prefix}_TOKEN`)};
    }
    const activations = activationDelivery(uploadApi, gameActivationClient(receivers, need('WILDSHARD_BUILD')), line => {console.log(line);});
    pollCatalogue({sweep: async () => {await activations.sweep(); return [];}}, {everyMs, log: line => {console.log(line);}});
  }
} else if (command === 'record') {
  console.log(JSON.stringify(await record()));
} else if (command === 'recook') {
  await record();
  const cook = worker(), rows = await cook.recook(['live']), preview = await cook.recook(['preview', 'staging']);
  console.log(JSON.stringify([...rows, ...preview]));
  // J29: a build takes no traffic with a live shard it couldn't cook. A refused head is already live, so it stops a deploy
  // too. A preview or staging head's verdict is the author's and stops nothing (MS2.4: staging is where a new author uploads).
  // SP7: the refusal names every live shard this build has no index for, so the deploy log says which to fix.
  const refusal = uncookedLiveRefusal(need('WILDSHARD_BUILD'), rows);
  if (refusal !== undefined) console.error(refusal);
  process.exit(refusal === undefined ? 0 : 1);
} else if (command === 'bake') {
  // A deploy's step after `recook`: a page reads each head's packs from the store (J138), with no client rebuild.
  const [dist, origin] = rest, api = need('WILDSHARD_API_URL'), source = apiSource(api, fetch, maxBytes);
  if (dist === undefined || origin === undefined || origin === '') throw new Error('usage: cook-worker bake <dist> <origin>');
  const placed = await fetch(`${api}/api/catalogue.json?stage=live`, { signal: AbortSignal.timeout(30_000) });
  if (!placed.ok) throw new Error(`Catalogue document answered ${placed.status}`);
  const out = resolve(dist), page = readFileSync(join(out, 'index.html'), 'utf8');
  const added = await addStoredShards(out, await source.heads('live'), store, source.download, { base: origin, shards: [] }, await placed.json());
  // The worker's copy of the page is the document it serves offline, so a page gains a shard only with this.
  if (added.length > 0) refreshServiceWorker(out, page);
  console.log(JSON.stringify(added));
} else if (command === 'gc') {
  // PZ5: a carried build's book, parts and content stay on R2, so a build any channel still carries is never collected.
  const channels = await liveDeployBuilds();
  const required = channels.flatMap(row => row.builds);
  const builds = [...new Set([...rest, ...required])];
  console.log(JSON.stringify({ channels, ...await collectGarbage(store, builds, Number(env.COOK_BUDGET_BYTES ?? PACK_BUDGET_BYTES), Date.now(), undefined, required) }));
} else if (command === 'reclaim') {
  // J505: the protected collection by hand (the same one a publish and the nightly run make)
  console.log(JSON.stringify(await reclaim()));
} else if (command === 'report') {
  console.log(JSON.stringify(await storeUsage(store, Number(env.COOK_BUDGET_BYTES ?? PACK_BUDGET_BYTES))));
} else {
  throw new Error('usage: cook-worker serve | recook | record | bake <dist> <origin> | gc <build>... | reclaim [<build>...] | report');
}
