/** CHUNK-PARAM-REMOVAL CP23: src/scripts/chunk-param-guard.mjs, for test/chunk-param-guard.test.ts. */
export function chunkParamCount(text: string): number;
export function chunkParamOffenders(input: { paths: string[]; read: (path: string) => string }): Record<string, number>;
export function judge(found: Record<string, number>, baseline: Record<string, number>): { added: string[]; shrunk: string[] };
export function oneShardBranches(read: (path: string) => string): number;
export function guardKey(path: string): string;
/** QA 11-25 row 99 (J522 (4)): the Playwright measuring tools, by their old-path key, which enter a zone alone. */
export const MEASURING: readonly string[];
export const GRID_ARM: string;
export function titleEntries(text: string): number;
export function measuringEntryOffenders(input: { paths: string[]; read: (path: string) => string }): Record<string, number>;
