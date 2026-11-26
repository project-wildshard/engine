export interface BuildCacheRow {
  cache: 'pine-map' | 'nine-casts' | 'nine-map' | 'assemblyscript-raw' | 'zstd-bytes' | 'other-generation';
  lookups: number; hits: number; diskHits: number; memoryHits: number; misses: number; populations: number;
  bypasses: number; writeFailures: number; populationRaces: number; bytesReused: number; bytesComputed: number; bytesStored: number;
}
export interface BuildCacheReport {
  version: 1; units: 'payload-bytes'; zeroLookups: 'not-invoked'; complete: boolean; products: { built: number; reused: number; failed: number }; invalidReports: number; caches: BuildCacheRow[];
}
export interface BuildCacheCounters {
  record: (input: unknown) => void;
  merge: (input: unknown) => boolean;
  product: (wasBuilt: boolean) => void;
  failure: () => void;
  snapshot: (complete: boolean) => BuildCacheReport;
}
export const BUILD_CACHE_REPORT_PREFIX: string;
export function createBuildCacheCounters(): BuildCacheCounters;
export function observeBuildCache(counters: BuildCacheCounters): () => void;
export function buildCacheReportReader(receive: (report: unknown) => void, forward: (text: string) => void, required?: boolean): { write: (chunk: string) => void; end: () => void };
export function formatBuildCacheReport(report: BuildCacheReport): string;
