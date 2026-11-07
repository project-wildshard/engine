/** Display name of one of the seven SF67 benchmark cards; unknown slugs are refused. */
export function loadingShardName(shard: string): string;
/** Whether the requested card requires Developer mode in the real picker. */
export function loadingShardNeedsDeveloper(shard: string): boolean;
/** Validate a comma-separated cohort before opening browser resources; duplicates are refused. */
export function loadingShards(value: string): string[];
/** Select exactly one visible card; missing/ambiguous cards cannot silently remove a benchmark row. */
export function loadingCardIndex(titles: readonly string[], shard: string): number;
