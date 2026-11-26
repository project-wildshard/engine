export interface ShardLayout { sourceLayout: { requiredFiles: string[]; allowedFiles: string[]; folders: string[] } }
export function checkShardLayout(entries: Record<string, string[]>, config: ShardLayout,
  outputs?: Readonly<Record<string, readonly string[]>>): string[];
export function shardEntries(paths: string[], selected?: Set<string>, homes?: readonly string[]): Record<string, string[]>;
export function checkShards(root: string, selected?: Set<string>): string[];
