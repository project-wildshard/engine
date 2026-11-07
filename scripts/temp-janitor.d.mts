/** A sweep's clock and report-only switch. */
export interface SweepOptions { now?: number; dryRun?: boolean }
/** Age, byte cap, clock and report-only switch for the compile cache. */
export interface CompileCacheOptions extends SweepOptions { capBytes?: number; maxAgeMs?: number }
/** What one compile cache prune found and removed. */
export interface CompileCacheReport { files: number; beforeBytes: number; removed: number; keptBytes: number }
/** Milliseconds since a path changed; a folder another lane has just removed counts as new. */
export function age(path: string, now: number): number;
/** Remove tmp/vitest/<pid> of dead processes idle for an hour; returns how many. */
export function sweepVitestRuns(root: string, options?: SweepOptions): number;
/** Remove test-only mkdtemp folders in tmp/ older than a day; returns how many. */
export function sweepTestScratch(root: string, options?: SweepOptions): number;
/** Remove compile cache entries past a day, then the oldest until under the byte cap. */
export function pruneCompileCache(directory: string, options?: CompileCacheOptions): CompileCacheReport;
