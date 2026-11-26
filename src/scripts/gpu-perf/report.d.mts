export const PHASE_LIMITS: Record<string, number>;
export const MEMORY_PROTOCOL: string;
export interface PendingMemory { fields: string[] }
export interface MemoryResult { verdict: string; reason: string; limitGB: number | undefined; growth?: number | null }
export interface SettledSample { seconds: number; nativeGB: number; inspectorGB: number }
export interface SettledReading { nativeGB: number; inspectorGB: number; minGB: number; maxGB: number; spreadGB: number; spreadPercent: number; samples: SettledSample[]; seconds: number }
export function settledMemory(samples: SettledSample[]): SettledReading | null;
export interface MemoryRow extends MemoryResult { shard: string; phase: string; nativeGB: number | undefined; inspectorGB: number | undefined; nativePeakGB?: number; previousGB: number | null; measurement: string; settling?: SettledReading }
export interface MemoryReferenceReport { sha?: string; started?: string; shards?: string[]; memoryProtocol?: string; steps?: { name: string; code: number }[]; memory?: MemoryRow[] }
export interface MemoryReference { path: string; sha: string | null; rejected: { path: string; sha: string | null; reason: string }[] }
export function memoryReferenceProblem(report: MemoryReferenceReport, shards: string[]): string | null;
export function selectMemoryReference(candidates: { path: string; report: MemoryReferenceReport }[], shards: string[], started: string): MemoryReference;
export function memoryVerdict(shard: string, phase: string, nativeGB: number | undefined, inspectorGB: number | undefined, previousGB: number | undefined, pending?: PendingMemory[]): MemoryResult;
export function parseMemoryRun(nativeText: string, inspectorText: string, shard: string, previous?: Record<string, number>, pending?: PendingMemory[]): MemoryRow[];
export function flakedFields(report: { flaked?: string[]; boot?: { shard: string; tier: string }; fields?: { field: string; verdict: string }[] }): string[];

export interface DesktopProjection { shard: string; pose: string; m5FrameMs: number | null; projected3060FrameMs: number | null; targetFrameMs: number; verdict: string; source: string; assumption: string; formula: string }
export function desktopProjections(report: { boot?: { shard?: string; tier?: string }; poses?: Record<string, { frameP95Ms?: number }> }, reference: { k3060: number; source: string; assumption: string }): DesktopProjection[];
