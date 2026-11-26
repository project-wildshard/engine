// Meta QA 11-25 row 61: the types of shard-sweep.mjs's pure half, for its test.
export interface Published {slug: string; revision: number; hash: string; channel: string; commit?: string}
export interface ShardRepo {repo: string; rows: Published[]; tags: Map<string, string>}
export type Action = {kind: 'pin'; slug: string; revision: number; hash: string; channel: string}
  | {kind: 'tag'; repo: string; tag: string; commit: string};
export function publishedRows(json: unknown): Published[];
export function missingTag(row: Published, tags: Map<string, string>): string | undefined;
export function sweepPlan(state: {repos: ShardRepo[]; pins: Map<string, number>; branches: Set<string>; runs: Map<string, string>}): {
  actions: Action[];
  notes: string[];
};
