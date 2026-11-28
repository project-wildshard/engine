import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cookedIndexKey, cookedShardPrefix, type CookedShardRef} from '../shared/game/shardfile/cookedPackPaths.ts';
import {carriedCookIndexes, keepCookIndexes, pruneCookedStore} from './cook-retention.ts';
import {PREFILL_KEEP_MS} from '../cook/game/cookedPrune.ts';
import type {ObjectHeaders, PackStore, StoredObject} from '../cook/game/packStore.ts';

const day = 86_400_000, now = Date.UTC(2026, 10, 26), older = now - 3 * day;
const origins = {production: 'https://production.test', staging: 'https://staging.test', preview: 'https://preview.test'};
const active = {slug: 'fixture', shardVersion: '0.0.1', cookVersion: '1.0.0', cookHash: 'a'.repeat(64)};
const carried = {...active, shardVersion: '0.0.2', cookHash: 'b'.repeat(64)};
const gone = {...active, shardVersion: '0.0.3', cookHash: 'c'.repeat(64)};
const tablePath = 'builds/0.1.97/abc1234/zone-table.json';
const hash = 'd'.repeat(64);
const response = (body: unknown): Response => Response.json(body);

const read: typeof fetch = async input => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname === '/deploy-chunks.json') {
    return response({format: 2, builds: [{files: []},
      {files: url.origin === origins.preview ? [{path: tablePath}] : []}]});
  }
  if (url.origin === origins.preview && url.pathname === `/${tablePath}`) {
    return response({version: 1, zones: [{index: cookedIndexKey(carried)}]});
  }
  throw new Error(`Unexpected read: ${url.href}`);
};

class MemoryStore implements PackStore {
  private data = new Map<string, {bytes: Uint8Array; modified: number}>();
  readonly removed: string[] = [];
  private readonly encode = new TextEncoder();
  seed(key: string, input: unknown): void {
    this.data.set(key, {bytes: this.encode.encode(JSON.stringify(input)), modified: older});
  }
  has(key: string): Promise<boolean> {return Promise.resolve(this.data.has(key));}
  get(key: string): Promise<Uint8Array | undefined> {return Promise.resolve(this.data.get(key)?.bytes);}
  put(key: string, body: Uint8Array, _headers: ObjectHeaders): Promise<void> {
    this.data.set(key, {bytes: body, modified: now});
    return Promise.resolve();
  }
  list(prefix: string): Promise<readonly StoredObject[]> {
    return Promise.resolve([...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, row]) =>
      ({key, bytes: row.bytes.byteLength, modified: row.modified})));
  }
  remove(key: string): Promise<void> {this.removed.push(key); this.data.delete(key); return Promise.resolve();}
}

function seedIndex(store: MemoryStore, ref: CookedShardRef): string {
  const part = `${cookedShardPrefix(ref)}common/piece.png`;
  store.seed(part, 'source bytes');
  store.seed(cookedIndexKey(ref), {...ref, hash, objects: {'assets/fixture/piece.png': part}});
  return part;
}

await test('preview carried builds keep their indexes and common objects after staging moves on', async () => {
  const store = new MemoryStore(), currentPart = seedIndex(store, active), carriedPart = seedIndex(store, carried), oldPart = seedIndex(store, gone);
  const orphan = `${cookedShardPrefix(active)}common/orphan.png`;
  store.seed(orphan, 'unreferenced');
  const tables = await carriedCookIndexes(read, origins);
  assert.deepEqual(tables.find(row => row.channel === 'preview')?.indexes, [cookedIndexKey(carried)]);
  const dryRun = await pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: true, origins, now});
  assert.deepEqual(store.removed, []);
  assert.deepEqual(dryRun.indexes.map(row => row.key), [cookedIndexKey(gone)]);
  assert.deepEqual(new Set(dryRun.objects.map(row => row.key)), new Set([oldPart, orphan]));
  await pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: false, origins, now});
  assert.ok(await store.has(currentPart));
  assert.ok(await store.has(carriedPart));
  assert.ok(await store.has(cookedIndexKey(carried)));
  assert.deepEqual(new Set(store.removed), new Set([cookedIndexKey(gone), oldPart, orphan]));
});

await test('production keeps a dropped index for seven days and staging for one', () => {
  const channels = [{channel: 'production', indexes: [cookedIndexKey(active)]},
    {channel: 'staging', indexes: [cookedIndexKey(carried)]}] as const;
  const kept = keepCookIndexes({}, channels, now);
  const dropped = keepCookIndexes(kept, [], now + day, channels);
  assert.deepEqual(dropped, {[cookedIndexKey(active)]: now + 8 * day, [cookedIndexKey(carried)]: now + 2 * day});
  assert.deepEqual(keepCookIndexes(dropped, [], now + 2 * day), {[cookedIndexKey(active)]: now + 8 * day});
  assert.deepEqual(keepCookIndexes(dropped, [], now + 8 * day), {});
});

await test('a missing kept index prevents any delete', async () => {
  const store = new MemoryStore();
  seedIndex(store, gone);
  await assert.rejects(pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: false, origins, now}), /keep index missing/u);
  assert.deepEqual(store.removed, []);
});

// PV29: PV26 prefilled the next release's cook (1.21.0) a day before any channel named it; the nightly prune kept only named
// indexes and those under a day old, so it would have taken the prefill. A retired version (older than every named one) goes.
await test('a prefill of a newer cook version stays seven days, and a retired version goes', async () => {
  const store = new MemoryStore();
  const prefill = {...active, cookVersion: '1.21.0', cookHash: 'e'.repeat(64)}, retired = {...active, cookVersion: '0.9.0', cookHash: 'f'.repeat(64)};
  seedIndex(store, active); seedIndex(store, carried);
  const prefillPart = `${cookedShardPrefix(prefill)}cooks/1.21.0/${prefill.cookHash}/piece.ktx2`, retiredPart = `${cookedShardPrefix(retired)}cooks/0.9.0/${retired.cookHash}/piece.ktx2`;
  store.seed(prefillPart, 'prefill bytes'); store.seed(retiredPart, 'retired bytes');
  store.seed(cookedIndexKey(prefill), {...prefill, hash, objects: {'assets/fixture/piece.ktx2': prefillPart}});
  store.seed(cookedIndexKey(retired), {...retired, hash, objects: {'assets/fixture/piece.ktx2': retiredPart}});
  const plan = await pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: true, origins, now});
  assert.ok(plan.keptIndexes.includes(cookedIndexKey(prefill)));
  assert.deepEqual(new Set([...plan.indexes, ...plan.objects].map(row => row.key)), new Set([cookedIndexKey(retired), retiredPart]));
  // past seven days the prefill is no longer ahead of a release: it goes too
  const late = await pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: true, origins, now: older + PREFILL_KEEP_MS + 1});
  assert.ok(late.indexes.some(row => row.key === cookedIndexKey(prefill)));
});

await test('a forced sweep runs even when the nightly one ran within the day', async () => {
  const store = new MemoryStore();
  seedIndex(store, active); seedIndex(store, carried); const oldPart = seedIndex(store, gone);
  await store.put('retained-indexes.json', new TextEncoder().encode(JSON.stringify({generatedAt: now - 60_000, keepUntil: {}})), {type: 'application/json', cache: 'private, no-store'});
  const skipped = await pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: false, origins, now});
  assert.deepEqual(skipped.indexes, []); assert.equal(store.removed.length, 0);
  await pruneCookedStore(store, read, [cookedIndexKey(active)], {dryRun: false, force: true, origins, now});
  assert.ok(store.removed.includes(cookedIndexKey(gone)) && store.removed.includes(oldPart));
});
