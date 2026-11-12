#!/usr/bin/env node
// C4 (J28, J29, J30): the cook worker.
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs serve     notify endpoint; lists the catalogue at boot
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs recook    every live and preview head, then exit; a deploy's step
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs bake <dist> <origin>   the live heads this build cooked, onto its built client
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs gc <build>...   keep those builds and every build a channel's
//     live deploy-chunks.json names (PAGE-SIZE PZ5: 5 a channel), delete the rest, print usage
//   node --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs report    print usage against the budget (J89)
// Environment: WILDSHARD_API_URL, WILDSHARD_BUILD; R2_ACCOUNT_ID, R2_BUCKET_PACKS, R2_PACKS_ACCESS_KEY_ID,
// R2_PACKS_SECRET_ACCESS_KEY, or COOK_STORE_DIR for a folder; COOK_NOTIFY_TOKEN; COOK_PORT (8792; 8790 and 8791 are the game's), COOK_HOST (127.0.0.1);
// COOK_SERVER_PACKS, COOK_SCRATCH; COOK_SECONDS, COOK_MEMORY_MB, COOK_HEAP_MB, COOK_MAX_SHARDFILE_BYTES; COOK_JOB_WRAP, a JSON array the host puts
// before each job to take its network away (see the wildshard-cook unit in scripts/vps/rebuild.sh).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { apiSource, collectGarbage, createCookWorker, DEFAULT_LIMITS, notifyServer, PACK_BUDGET_BYTES, storeUsage } = await import('../src/cook/game/cookWorker.ts');
const { MAX_SHARDFILE_BYTES } = await import('../src/cook/game/cookJob.ts');
const { addStoredShards } = await import('./app-build/catalogue.ts');
const { refreshServiceWorker } = await import('./app-build/serviceWorker.ts');
const { folderStore, r2Store } = await import('../src/cook/game/packStore.ts');
const { rendererRevision } = await import('./renderer-revision.mjs');
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
const worker = () => createCookWorker({
  build: need('WILDSHARD_BUILD'), store, source: apiSource(need('WILDSHARD_API_URL'), fetch, maxBytes), log: line => { console.log(line); },
  serverPacks: resolve(env.COOK_SERVER_PACKS ?? 'tmp/cook/server'), scratch: resolve(env.COOK_SCRATCH ?? 'tmp/cook/scratch'),
  launcher: {
    root, execPath: process.execPath, loader: fileURLToPath(new URL('bake-loader.mjs', import.meta.url)), script: fileURLToPath(new URL('cook-job.mjs', import.meta.url)),
    wrap: JSON.parse(env.COOK_JOB_WRAP ?? '[]'), ...(renderer === undefined ? {} : { renderer }),
    limits: { seconds: Number(env.COOK_SECONDS ?? DEFAULT_LIMITS.seconds), memoryMB: Number(env.COOK_MEMORY_MB ?? DEFAULT_LIMITS.memoryMB), heapMB: Number(env.COOK_HEAP_MB ?? DEFAULT_LIMITS.heapMB), maxBytes },
  },
});

const [command, ...rest] = process.argv.slice(2);
if (command === 'serve') {
  const cook = worker(), port = Number(env.COOK_PORT ?? 8792), host = env.COOK_HOST ?? '127.0.0.1';
  notifyServer(cook, need('COOK_NOTIFY_TOKEN')).listen(port, host, () => { console.log(`cook worker on ${host}:${port}`); });
  // J30: what a missed notice left behind. A catalogue that can't be read waits for the next notice.
  try { await cook.recook(['live', 'preview']); } catch (error) { console.error(`boot list failed: ${String(error)}`); }
} else if (command === 'recook') {
  const cook = worker(), rows = await cook.recook(['live']), preview = await cook.recook(['preview']);
  console.log(JSON.stringify([...rows, ...preview]));
  // J29: a build takes no traffic with a live shard it couldn't cook. A refused head is already live, so it stops a deploy
  // too. A preview head has players on no build, so its verdict is the author's and stops nothing.
  process.exit(rows.every(row => row.state === 'cooked' || row.state === 'present') ? 0 : 1);
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
  const builds = [...new Set([...rest, ...channels.flatMap(row => row.builds)])];
  console.log(JSON.stringify({ channels, ...await collectGarbage(store, builds, Number(env.COOK_BUDGET_BYTES ?? PACK_BUDGET_BYTES), Date.now()) }));
} else if (command === 'report') {
  console.log(JSON.stringify(await storeUsage(store, Number(env.COOK_BUDGET_BYTES ?? PACK_BUDGET_BYTES))));
} else {
  throw new Error('usage: cook-worker serve | recook | bake <dist> <origin> | gc <build>... | report');
}
