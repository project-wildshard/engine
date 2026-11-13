/** SA45: a file in shard source, in either layout (`src/shards/<slug>/` or a single-shard repo's `src/`). */
export interface ShardFile { readonly slug: string; readonly local: string; readonly base: string; readonly path: string }
export interface LintFile { readonly root: string; readonly file: string; readonly path: string; readonly shard: ShardFile | null }
export function repoShardSlug(repo: string): string | null;
export function shardFile(root: string, file: string): ShardFile | null;
export function shardSourceDirs(root: string): string[];
export function lintFile(filename: string, base: string): LintFile;
export function sourcePath(filename: string, base: string): string;
export function shardOfFilename(filename: string): { readonly slug: string; readonly local: string; readonly dir: string } | null;
