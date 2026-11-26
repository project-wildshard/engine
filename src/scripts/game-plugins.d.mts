/** A defining game module currently reached by primary trusted runtimes, directly or through SDK facades. */
export interface GamePluginModule { specifier: string; target: string | null; facades: string[]; shards: string[]; published: boolean }
/** Discover the migration's plugin surface without rebinding values or admitting a new module. */
export function gamePluginInventory(root?: string): GamePluginModule[];

/** One explicit package export and all literal consumers, split into shard and other consumers. */
export interface GamePluginExport {
  key: string; target: string | null; plugin: boolean; published: boolean;
  primaryConsumers: string[]; otherConsumers: string[];
}
/** Export counts stay independent of compatibility consumers; this report grants no exception or permission. */
export function gamePluginSurface(root?: string): {
  enforcement: 'report-only'; limit: number; totalExports: number; pluginExports: number;
  withinPluginLimit: boolean; pluginOnly: boolean; entries: GamePluginExport[];
  unresolved: { specifier: string; consumers: string[] }[];
};

/** Hard export audit: twenty defining plugins and the named migration tails. */
export function checkGamePluginExports(root?: string, surface?: ReturnType<typeof gamePluginSurface>): {
  failures: string[]; pluginExports: number;
  temporary: { key: string; target: string; owner: string; reason: string }[];
};
