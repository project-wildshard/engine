/** SHARD-SIZE row 1: each web build refuses a shard whose phone download grew. */
export interface ShardSizeRow { baselinePhoneBytes: number; recordedPhoneBytes: number; ceilingPhoneBytes: number; latchedPhoneBytes?: number; shrinkOnly: boolean }
export interface ShardSizeRaise { shard: string; toBytes: number; decision: string; why: string }
export interface ShardSizeBaseline {
  limits: { newShardHardCapBytes: number; toleranceBytes: number; ratchetSlackBytes: number };
  shards: Record<string, ShardSizeRow>;
  raises: readonly ShardSizeRaise[];
}
export const BASELINE_FILE: string;
export function readPhoneDownloads(dist: string): Record<string, number> | null;
export function checkShardSizes(baseline: ShardSizeBaseline, downloads: Record<string, number>, options?: { cooksAfter?: boolean }): { errors: string[]; notes: string[] };
export function ratchetShardSizes<T extends { limits: { ratchetSlackBytes: number }; shards: Record<string, Pick<ShardSizeRow, 'ceilingPhoneBytes' | 'latchedPhoneBytes' | 'shrinkOnly'>> }>(baseline: T, downloads: Record<string, number>): T;
export function folderBuckets(folder: string): { totalBytes: number; files: number; buckets: Record<string, number> };
