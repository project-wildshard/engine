#!/usr/bin/env node
// K4: both immutable local caches use 24-hour idle retention and a 4 GiB LRU cap.
import { recorderCacheRoot, pruneRecorderCache } from './native-recorder-cache.mjs';
import { pruneShardfileCache, shardfileCacheRoot } from './shardfile-cache.mjs';

const dryRun = process.argv.includes('--dry-run');
const generated = pruneRecorderCache(recorderCacheRoot(), { dryRun });
const shardfiles = pruneShardfileCache(shardfileCacheRoot(), { dryRun });
console.info(JSON.stringify({ dryRun, generate: { deleted: generated.deleted.length, freedBytes: generated.freedBytes,
  keptBytes: generated.keptBytes, locked: generated.locked }, shardfiles }));
