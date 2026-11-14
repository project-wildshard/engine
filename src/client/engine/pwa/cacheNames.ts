/** MF1/MF4: immutable code, content and versioned metadata, keyed by exact absolute URL. Production's name; the other
 *  channels' names carry the channel (`cacheName`). */
export const ASSET_CACHE_NAME = 'ws-assets-v1';

/** OFFLINE OF12 (J298, Jake 2026-11-12: "The preview build should have a different cache"): every Cache Storage name a
 *  build writes carries its channel, so preview and staging on one origin (a local proof, any later shared host) keep
 *  disjoint caches and neither's activate deletes the other's. One bundle serves every channel and the deploy stamps
 *  `__WS_WORLD__` into the document, so the channel is read at run time, as `homeIconChannel` (app-build/homeIcons.mjs)
 *  reads it: no world is preview, a world whose release file is production's is production, any other world is staging.
 *  Production keeps the names it always had (renaming them would cold-start every player's cache); preview and staging
 *  put the channel after `ws-` (`ws-preview-assets-v1`, `ws-staging-shell-v3-<build>`), so production's prefix tests
 *  (`ws-shell-`) never match another channel's caches. */
export type CacheChannel = 'production' | 'staging' | 'preview';
export const CACHE_CHANNELS: readonly CacheChannel[] = ['production', 'staging', 'preview'];

/** The channel of a build stamp (`__WS_WORLD__`, or undefined on a build with no world). */
export function cacheChannel(world: unknown): CacheChannel {
  if (typeof world !== 'object' || world === null) return 'preview';
  const release: unknown = Reflect.get(world, 'release');
  return typeof release === 'string' && /\/releases\/production\.json(?:[?#]|$)/u.test(release) ? 'production' : 'staging';
}

/** One cache name for a channel: production's as given; another channel's with the channel after `ws-`. */
export function cacheName(base: string, channel: CacheChannel): string {
  if (channel === 'production') return base;
  return base.startsWith('ws-') ? `ws-${channel}-${base.slice(3)}` : `${base}-${channel}`;
}

/** Whether a Cache Storage name is this channel's own (production's are the `ws-` names no other channel prefixes). */
export function ownsCache(name: string, channel: CacheChannel): boolean {
  if (channel !== 'production') return name.startsWith(`ws-${channel}-`);
  return name.startsWith('ws-') && !CACHE_CHANNELS.some(other => other !== 'production' && name.startsWith(`ws-${other}-`));
}

/** A dedicated worker has no document stamp: the page that starts it hands it the channel (`setCacheChannel`). */
let given: CacheChannel | undefined;
export function setCacheChannel(channel: unknown): void {
  if (typeof channel === 'string' && (CACHE_CHANNELS as readonly string[]).includes(channel)) given = channel as CacheChannel;
}

/** This page's (or this worker's, once told) channel. */
export function pageCacheChannel(): CacheChannel {
  return given ?? cacheChannel((globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__);
}

/** The cross-build asset cache of this page's channel. */
export function assetCacheName(): string { return cacheName(ASSET_CACHE_NAME, pageCacheChannel()); }

/** A production worker opens this empty cache, so another channel's worker on the same origin can tell production's
 *  caches (kept) from its own channel's from before OF12, which used production's names (deleted once, see `isForeign`). */
export const PRODUCTION_MARK = 'ws-production-mark';

/** Whether a cache belongs to another channel that is on this origin, which this channel must never delete. Production's
 *  names are another channel's only where a production worker has run (`productionHere`, its mark); elsewhere they are
 *  this origin's own caches from before the channel names, a one-time cold start's leftovers. */
export function isForeign(name: string, channel: CacheChannel, productionHere: boolean): boolean {
  if (ownsCache(name, channel) || !name.startsWith('ws-')) return false;
  return channel === 'production' || !ownsCache(name, 'production') || productionHere;
}
