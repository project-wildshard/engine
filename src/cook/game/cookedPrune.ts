import { cookedIndexKey, readCookedIndexAddress } from '../../shared/game/shardfile/cookedPackPaths';
import type { PackStore, StoredObject } from './packStore';

const INDEX = /^shards\/[^/]+\/[^/]+\/cooks\/[^/]+\/[a-f0-9]{64}\/index\.json$/u;
const OWNED = /^shards\/[^/]+\/[^/]+\/(?:common\/|cooks\/)[\w./-]+$/u;
const DAY_MS = 24 * 60 * 60_000;

export interface CookPrunePlan {
  readonly keptIndexes: readonly string[];
  readonly keptObjects: number;
  readonly indexes: readonly StoredObject[];
  readonly objects: readonly StoredObject[];
  readonly bytes: number;
}

/** Keep named indexes and uploads still being published. A bad or missing named index prevents all deletion. */
export async function planCookPrune(store: Pick<PackStore, 'list' | 'get'>, named: ReadonlySet<string>, now: number): Promise<CookPrunePlan> {
  if (named.size === 0) throw new Error('Cook prune needs the live and carried index keys');
  const rows = (await store.list('shards/')).filter(row => OWNED.test(row.key));
  const indexes = rows.filter(row => INDEX.test(row.key)), present = new Set(indexes.map(row => row.key));
  const missing = [...named].filter(key => !present.has(key));
  if (missing.length > 0) throw new Error(`Cook prune keep index missing: ${missing[0] ?? ''}`);
  const keptIndexes = indexes.filter(row => named.has(row.key) || now - row.modified < DAY_MS).map(row => row.key);
  const retained = new Set(keptIndexes), keptObjects = new Set<string>(), decode = new TextDecoder();
  for (const key of keptIndexes) {
    const bytes = await store.get(key);
    if (bytes === undefined) throw new Error(`Cook prune keep index left while reading: ${key}`);
    const address = readCookedIndexAddress(JSON.parse(decode.decode(bytes)) as unknown);
    if (cookedIndexKey(address) !== key) throw new Error(`Cook prune index does not match its key: ${key}`);
    for (const object of Object.values(address.objects)) keptObjects.add(object);
  }
  const deadIndexes = indexes.filter(row => !retained.has(row.key));
  const objects = rows.filter(row => !INDEX.test(row.key) && !keptObjects.has(row.key) && now - row.modified >= DAY_MS);
  const bytes = [...deadIndexes, ...objects].reduce((sum, row) => sum + row.bytes, 0);
  return {keptIndexes, keptObjects: keptObjects.size, indexes: deadIndexes, objects, bytes};
}
