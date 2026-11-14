/** Fixed G682 hello-world WebKit 120s WebContent+GPU calibration; no growth re-base. */
export const webKitCoreMemoryFloorBytes: number;
/** Independent floors with the G682 allowance above the WebKit calibration. */
export const coreMemoryTargets: readonly Readonly<{shard: string; name: string; limitBytes: number}>[];
export const helloWorldMemoryTarget: Readonly<{shard: 'hello'; name: string; limitBytes: null}>;
export const webGLMemoryTarget: Readonly<{shard: 'webgl'; name: string; limitBytes: null}>;
export const threeMemoryTarget: Readonly<{shard: 'three'; name: string; limitBytes: null}>;
export const helloWorldMemoryHTML: string;
export const webGLMemoryHTML: string;
export const threeMemoryHTML: string;
export function serveHelloWorldMemory(three?: boolean): Promise<{url: string; modules: {path: string; bytes: number; sha256: string}[]; close: () => Promise<void>}>;
export function helloWorldMemoryFloor(input: unknown): {phase: string; rendererBytes: number; gpuBytes: number; totalBytes: number; menuLimitBytes: number; templateLimitBytes: number};
/** Diagnostic context-only native total; no app budget or fitted estimator base. */
export function webGLMemoryFloor(input: unknown): {phase: string; rendererBytes: number; gpuBytes: number; totalBytes: number};
/** Empty renderer diagnostic, separate from every app budget and G682 base. */
export function threeMemoryFloor(input: unknown): {phase: string; rendererBytes: number; gpuBytes: number; totalBytes: number};
/** A refused diagnostic retains its raw row in the caller's summary and remains a failing result. */
export function contextMemoryDiagnostic(input: unknown): {calibration: {shard: string; phase: string; rendererBytes: number; gpuBytes: number; totalBytes: number} | null; error: string | null};
/** Select one target, all four app floors, or the separate hello-world calibration. */
export function selectedCoreMemoryTargets(selection: string): readonly (typeof coreMemoryTargets[number] | typeof helloWorldMemoryTarget | typeof webGLMemoryTarget | typeof threeMemoryTarget)[];
/** Distinct loaded script URLs, without fetching or retaining response bodies. */
export function scriptResourceURLs(entries?: readonly {name: string}[]): string[];
/** Bounded Node-side metadata after native acceptance; no page/Inspector fetch, admission or budget verdict. */
export function coreMemoryFolderIdentity(base: string, shard: string, version: string, read?: typeof fetch): Promise<
  {status: 'observed'; phase: 'after-120s'; build: string; shard: string; path: string; indexBytes: number; indexHash: string; sourceHash: string} |
  {status: 'unavailable'; phase: 'after-120s'; error: string} | null>;
/** G682 requires the cold uncollected native WebKit protocol; missing/errors fail as unknown. Select one app floor or default to all four. */
export function coreMemorySummary(input: unknown, selection?: string): {shard: string; name: string; limitBytes: number; totalBytes: number | null; passed: boolean}[];
/** Exact +/-15% comparison with an explicit prediction; never changes the native G682 verdict. */
export function coreMemoryEstimateAudit(input: unknown, selection: string, estimate: number): {shard: string; estimatedBytes: number; measuredBytes: number | null; budgetPassed: boolean; errorPercent: number | null; within15Percent: boolean | null};
/** Chromium totals are diagnostics, never WebKit budget qualifications. */
export function chromiumCoreMemorySummary(input: unknown): {shard: string; name: string; totalBytes: number | null}[];
export interface SimulatorCoreProcess {pid: number; startAbstime: number; physicalFootprintBytes: number}
export interface SimulatorCoreFootprint {webContent: SimulatorCoreProcess[]; gpu: SimulatorCoreProcess[]; rendererBytes: number; gpuBytes: number}
export function simulatorCoreFootprint(input: unknown): SimulatorCoreFootprint;
/** Caller owns sim-lane; reads only processes below its Simulator launchd. */
export function readSimulatorCoreFootprint(device: string): SimulatorCoreFootprint;
