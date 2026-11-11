import { createHash } from 'node:crypto';
import * as v from 'valibot';
import { readWeights } from './test-timings.mjs';

/** G989 prefers twelve longer two-worker jobs to a larger runner burst. */
export const CI_SHARD_COUNT = 12;
/** Fallback only: old isolated runs measured six seconds of setup/imports. */
export const LEGACY_FILE_OVERHEAD = 6;

/** Seconds per file from main's last measured run (scripts/test-timings.mjs, LS2), or null with no table. */
export function readDurations(env: NodeJS.ProcessEnv = process.env): Map<string, number> | null {
  const out = new Map(Object.entries(readWeights('full', env)));
  return out.size > 0 ? out : null;
}

/** Deterministic LPT packing; measured complete-module weights use overhead=0. */
export function packShards(paths: readonly string[], durations: ReadonlyMap<string, number>, count: number, overhead = LEGACY_FILE_OVERHEAD): string[][] {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(overhead) || overhead < 0) throw new Error('Invalid shard count or overhead');
  const known = [...durations.values()].sort((a, b) => a - b);
  const median = known[Math.floor(known.length / 2)] ?? 1;
  const weight = (path: string): number => (durations.get(path) ?? median) + overhead;
  const order = [...paths].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: count }, () => ({ total: 0, paths: [] as string[] }));
  for (const path of order) {
    const lightest = shards.reduce((best, shard) => (shard.total < best.total || (shard.total === best.total && shard.paths.length < best.paths.length) ? shard : best));
    lightest.total += weight(path); lightest.paths.push(path);
  }
  return shards.map(shard => shard.paths);
}

const seconds = v.pipe(v.number(), v.finite(), v.minValue(0));
const positive = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const schema = v.object({
  version: v.literal(1), sha: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)), run: v.nullable(v.string()),
  shardCount: positive, workers: positive, inventoryHash: v.string(), expectedSeconds: seconds,
  fallbackSeconds: seconds, measuredFiles: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  shards: v.array(v.object({ index: positive, files: v.array(v.string()), totalSeconds: seconds, expectedSeconds: seconds })),
});
export type ShardPlan = v.InferOutput<typeof schema>;

export function inventoryHash(paths: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([...paths].sort())).digest('hex');
}

/** Validate complete membership before the sequencer selects even one shard. */
export function readShardPlan(value: unknown, paths: readonly string[], count: number, source?: { sha: string; run?: string }): ShardPlan {
  const plan = v.parse(schema, value), flat = plan.shards.flatMap(shard => shard.files);
  if (plan.shardCount !== count || plan.shards.length !== count || plan.shards.some((shard, index) => shard.index !== index + 1)) throw new Error('Shard plan count differs');
  if (new Set(paths).size !== paths.length || new Set(flat).size !== flat.length || flat.length !== paths.length || inventoryHash(flat) !== inventoryHash(paths) || plan.inventoryHash !== inventoryHash(paths)) throw new Error('Shard plan test inventory differs');
  if (source !== undefined && (plan.sha !== source.sha || (source.run !== undefined && plan.run !== source.run))) throw new Error('Shard plan source/run differs');
  return plan;
}

/** The expected wall is the slowest worker bin, not a serial sum divided blindly. */
export function createShardPlan(paths: readonly string[], weights: ReadonlyMap<string, number>, options: { count: number; workers: number; sha: string; run: string | null; fallbackSeconds: number; measuredFiles: number }): ShardPlan {
  if (paths.length === 0 || new Set(paths).size !== paths.length) throw new Error('Empty or duplicate discovered test file');
  const weighted = new Map(paths.map(path => [path, weights.get(path) ?? options.fallbackSeconds]));
  if ([...weighted.values()].some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid measured test weight');
  const shards = packShards(paths, weighted, options.count, 0).map((files, index) => {
    const total = (part: readonly string[]): number => part.reduce((sum, path) => sum + (weighted.get(path) ?? options.fallbackSeconds), 0);
    return { index: index + 1, files, totalSeconds: total(files), expectedSeconds: Math.max(0, ...packShards(files, weighted, options.workers, 0).map(total)) };
  });
  return readShardPlan({ version: 1, sha: options.sha, run: options.run, shardCount: options.count, workers: options.workers,
    inventoryHash: inventoryHash(paths), expectedSeconds: Math.max(0, ...shards.map(shard => shard.expectedSeconds)),
    fallbackSeconds: options.fallbackSeconds, measuredFiles: options.measuredFiles, shards }, paths, options.count);
}
