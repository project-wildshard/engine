export interface ShardInfo {
  readonly slug: string;
  readonly name: string;
  readonly status: 'live' | 'earlyAccess' | 'experimental' | 'hidden';
}

export function readShards(root?: string): Promise<readonly ShardInfo[]>;
