import * as v from 'valibot';
import {planCookPrune, type CookPrunePlan} from '../cook/game/cookedPrune.ts';
import {inParallel, PUT_PARALLEL} from '../cook/game/cookWorker.ts';
import type {PackStore} from '../cook/game/packStore.ts';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const SNAPSHOT = 'retained-indexes.json';
const TABLE = /^(?:b\/[\w.-]+|builds\/[\w.-]+\/[\w.-]+)\/zone-table\.json$/u;
const INDEX = /^shards\/([a-z0-9-]+\/\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?\/)cooks\/[\d.]+\/[a-f0-9]{64}\/index\.json$/iu;
const key = v.pipe(v.string(), v.regex(INDEX));
const table = v.object({version: v.literal(1), zones: v.pipe(v.array(v.object({index: key})), v.minLength(1))});
const graph = v.object({files: v.array(v.object({path: v.string()}))});
const deploy = v.variant('format', [v.object({format: v.literal(1), files: graph.entries.files}), v.object({format: v.literal(2), builds: v.array(graph)})]);
const isoTime = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const channelName = v.picklist(['production', 'staging', 'preview']);
const seenChannel = v.object({channel: channelName, indexes: v.array(key)});
const snapshot = v.object({generatedAt: isoTime, keepUntil: v.record(key, isoTime), seen: v.optional(v.array(seenChannel))});

export const COOK_PAGE_ORIGINS = {
  production: 'https://play.wildshard.io',
  staging: 'https://staging.wildshard.io',
  preview: 'https://preview.wildshard.io',
} as const;
type Channel = keyof typeof COOK_PAGE_ORIGINS;
interface ChannelIndexes {
  readonly channel: Channel;
  readonly indexes: readonly string[];
}
type Retained = Readonly<Record<string, number>>;

async function pageJson(read: typeof fetch, url: URL): Promise<unknown> {
  const response = await read(url, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
  if (!response.ok || response.headers.get('content-type')?.includes('text/html') === true) {
    await response.body?.cancel();
    throw new Error(`Cook retention cannot read ${url.href}: ${response.status}`);
  }
  return response.json();
}

/** Each channel's own current and carried build files name the zone tables it can still play. */
export async function carriedCookIndexes(read: typeof fetch, origins: Readonly<Record<Channel, string>> = COOK_PAGE_ORIGINS): Promise<readonly ChannelIndexes[]> {
  return Promise.all((['production', 'staging', 'preview'] as const).map(async channel => {
    const origin = origins[channel], index = v.parse(deploy, await pageJson(read, new URL('/deploy-chunks.json', origin)));
    const rows = index.format === 1 ? index.files : index.builds.flatMap(row => row.files);
    const paths = [...new Set(rows.map(row => row.path).filter(path => TABLE.test(path) && !path.split('/').includes('..')))];
    const tables = await Promise.all(paths.map(async path => v.parse(table, await pageJson(read, new URL(path, origin)))));
    return {channel, indexes: tables.flatMap(table => table.zones.map(row => row.index))};
  }));
}

export function keepCookIndexes(current: Retained, channels: readonly ChannelIndexes[], now: number,
  previous: readonly ChannelIndexes[] = []): Retained {
  const kept = new Map(Object.entries(current).filter(([, until]) => until > now));
  // The first sweep that observes a build gone starts its grace period.
  for (const {channel, indexes} of [...previous, ...channels]) {
    const until = now + (channel === 'production' ? 7 : 1) * DAY_MS;
    for (const index of indexes) {
      if (!INDEX.test(index)) throw new Error(`Not a cooked index key: ${index}`);
      kept.set(index, Math.max(kept.get(index) ?? 0, until));
    }
  }
  return Object.fromEntries(kept);
}

export async function pruneCookedStore(store: PackStore, read: typeof fetch, currentIndexes: readonly string[],
  options: Readonly<{now: number; dryRun: boolean; origins?: Readonly<Record<Channel, string>>}>): Promise<CookPrunePlan> {
  const held = await store.get(SNAPSHOT);
  const prior = held === undefined ? undefined : v.parse(snapshot, JSON.parse(new TextDecoder().decode(held)) as unknown);
  if (!options.dryRun && prior !== undefined && options.now - prior.generatedAt < DAY_MS) {
    return {keptIndexes: Object.keys(prior.keepUntil), keptObjects: 0, indexes: [], objects: [], bytes: 0};
  }
  const channels = await carriedCookIndexes(read, options.origins);
  const seen = channels.map(row => row.channel === 'staging' ? {...row, indexes: [...new Set([...row.indexes, ...currentIndexes])]} : row);
  const keepUntil = keepCookIndexes(prior?.keepUntil ?? {}, seen, options.now, prior?.seen);
  const keys = Object.keys(keepUntil), plan = await planCookPrune(store, new Set(keys), options.now);
  if (options.dryRun) return plan;
  const prefixes = [...new Set(keys.map(path => `shards/${INDEX.exec(path)?.[1] ?? ''}`))].sort();
  await store.put(SNAPSHOT, new TextEncoder().encode(JSON.stringify({generatedAt: options.now, keepUntil, prefixes, seen})),
    {type: 'application/json', cache: 'private, no-store'});
  // Remove indexes before their objects. Interrupted deletes remain eligible on the next run.
  await inParallel(plan.indexes, PUT_PARALLEL, row => store.remove(row.key));
  await inParallel(plan.objects, PUT_PARALLEL, row => store.remove(row.key));
  return plan;
}
