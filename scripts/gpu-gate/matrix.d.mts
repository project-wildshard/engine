export interface Job { shard: string; mode: string; part: string }
export const SPLIT: Set<string>;
export function matrix(sha: string, mode: string, options?: { cwd?: string; split?: Set<string>; recordShards?: readonly string[] }): Job[];
