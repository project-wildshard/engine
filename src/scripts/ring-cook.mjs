#!/usr/bin/env node
// Ring 1 cooks actual pins through the production bounded worker and folder store.
// The resulting receipt is consumed by the store boot; a cook is not a detached check.
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

await import('./bake-loader.mjs');
const { createCookWorker, indexKey, DEFAULT_LIMITS } = await import('../cook/game/cookWorker.ts');
const { folderStore } = await import('../cook/game/packStore.ts');
const { cookHash } = await import('./cookHash.ts');
const { ringCookInputs } = await import('./ring-cook-inputs.ts');
const { rendererRevision } = await import('./renderer-revision.mjs');
const { shardfileValidationRevision } = await import('./shardfile-validation-revision.mjs');
const { values } = parseArgs({ options: { out: {type:'string',default:'tmp/ring-cook'}, build: {type:'string',default:'ring-local'},
  only: {type:'string'}, pins: {type:'string',default:'test/pins/shardfiles.json'}, ring2: {type:'boolean',default:false}, 'timeout-ms': {type:'string',default:'120000'} } });
const timeout = Number(values['timeout-ms']);
const maximumTimeout = DEFAULT_LIMITS.seconds * 1000;
if (!Number.isFinite(timeout) || timeout <= 0 || timeout > maximumTimeout) {
  throw new Error(`Cook timeout must be in (0, ${maximumTimeout}] ms`);
}
const root = process.cwd(), out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`Cook output must be empty: ${out}`);
const cache = process.env.WILDSHARD_PIN_CACHE ?? resolve(homedir(), '.cache/wildshard/pins');
/** @type {{products: string[]}} */
const { products } = JSON.parse(readFileSync('test/pins/rings.json','utf8'))['1'];
/** @type {{shards: {slug: string,hash: string}[]}} */
const { shards } = JSON.parse(readFileSync(values.pins,'utf8'));
const allowed = values.ring2 ? shards.map(row => row.slug) : products;
const selected = values.only === undefined ? allowed : values.only.split(',');
if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some(slug => !allowed.includes(slug))) throw new Error('Cook selection must name distinct pinned products in this ring');
const inputs=ringCookInputs(selected,shards,cache),heads=inputs.heads;
const store = folderStore(join(out,'store'));
// Ring 2 qualifies the production worker, including its heap/resident limits.
// Keep Ring 1's established smaller envelope; neither path extends its clock.
// The hosted cook has the runner to itself until the browser starts. Give
// that CPU allowance to the worker so it reserves one core instead of two.
// A live broker grant still bounds the allowance inside runJob.
const limits = values.ring2 ? {...DEFAULT_LIMITS, seconds: timeout / 1000,
  ...(process.env.GITHUB_ACTIONS === 'true' ? {cpuSlots: availableParallelism()} : {}),
} : {seconds:timeout/1000,memoryMB:4096,heapMB:2048};
console.log(`cook limits: ${JSON.stringify(limits)}`);
// A fresh run owns its empty cache. At least its first product always encodes cold.
const worker = createCookWorker({ build: values.build, store, serverPacks: join(out,'server'), scratch: join(out,'jobs'), validator: shardfileValidationRevision(root),
  source: { heads: () => Promise.resolve(heads.map(row => ({...row, revision:1}))), download: hash => Promise.resolve(inputs.read(hash)) },
  launcher: { root, execPath: process.execPath, loader:join(root,'src/scripts/bake-loader.mjs'), script:join(root,'src/scripts/cook-job.mjs'),
    wrap:[], limits, renderer: rendererRevision(root) },
  log: line => console.log(line) });
const recipe = cookHash(), indexes = [];
for (const head of heads) {
  const started = performance.now(), row = await worker.cook(head);
  if (row.state !== 'cooked') throw new Error(`${head.slug}: ${row.state}: ${row.detail ?? 'no cook result'}`);
  const bytes = await store.get(indexKey(values.build,head.hash));
  if (bytes === undefined) throw new Error('Cook published no index');
  const index = JSON.parse(new TextDecoder().decode(bytes)); indexes.push(index);
  console.log(`${head.slug}: ${index.proof}, ${index.keys.length} stored objects, ${((performance.now()-started)/1000).toFixed(1)}s${index.preparation === undefined || index.preparation === 'none' ? '' : `, ${index.preparation} preparation`}`);
  if (index.preparation === 'stale') console.warn(`stale preparation: ${head.slug}`);
}
if (cookHash().cookHash !== recipe.cookHash) throw new Error('Cook source changed during the batch');
const receipt = { build:values.build, cook:recipe, store:join(out,'store'), heads, indexes };
writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt));
console.log(JSON.stringify({receipt:join(out,'receipt.json')}));
