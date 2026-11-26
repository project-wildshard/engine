import type { SweepOptions } from './.kit/vite-tmp.mjs';

export type { CompileCacheOptions, CompileCacheReport, SweepOptions } from './.kit/vite-tmp.mjs';
export { age, pruneCompileCache, sweepSystemTemp, sweepVitestRuns } from './.kit/vite-tmp.mjs';
/** Remove test-only mkdtemp folders in tmp/ older than a day; returns how many. */
export function sweepTestScratch(root: string, options?: SweepOptions): number;
