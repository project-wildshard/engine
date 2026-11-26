/** PAGE-SIZE PZ1: what a built page holds, by kind, and the carried builds' share. */
export interface Tally { files: number; bytes: number; carriedFiles: number; carriedBytes: number }
export interface PageSize { dir: string; carriedBuilds: number | undefined; total: Tally; kinds: Record<string, Tally>; parts: Record<string, Tally> }
export const KINDS: readonly string[];
export const SHARD_PARTS: Readonly<Record<string, string>>;
export function shardNames(dir: string): Set<string>;
export function classify(path: string, shards: ReadonlySet<string>): {kind: string; part?: string};
export function carriedPaths(dir: string): {builds: number; paths: Set<string>} | undefined;
export function pageSize(dir: string): PageSize;
export function formatPageSize(report: PageSize): string;
/** PZ4, D1 yes: a page holds at most 1,000 files and 100 MB, maps left out. */
export const PAGE_LIMITS: Readonly<{files: number; bytes: number}>;
export function gatePage(report: PageSize, limits?: {files: number; bytes: number}): string[];
