/** CHUNK-PARAM-REMOVAL CP23: src/scripts/chunk-param-guard.mjs, for test/chunk-param-guard.test.ts. */
export function chunkParamCount(text: string): number;
export function chunkParamOffenders(input: { paths: string[]; read: (path: string) => string }): Record<string, number>;
export function judge(found: Record<string, number>, baseline: Record<string, number>): { added: string[]; shrunk: string[] };
export function oneShardBranches(read: (path: string) => string): number;
export function guardKey(path: string): string;
