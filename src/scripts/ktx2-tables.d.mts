interface Table { phone: Record<string, string>; desktop: Record<string, string> }
interface Shard { slug: string; assetGlobs?: readonly string[] }
export function splitKtx2(map: Table, shards: readonly Shard[]): Map<string, Table>;
export function engineKtx2TableSource(root: string): string;
export function writeKtx2Tables(root: string, map: Table, shards: readonly Shard[]): void;
