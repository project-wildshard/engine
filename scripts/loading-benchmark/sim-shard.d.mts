import type { AdmissionFrames } from './accuracy-data.d.mts';

/** Preserve caller configuration while isolating this reader's preview lease. */
export function compiledPreviewEnvironment(environment: Record<string, string | undefined>, pid: number): Record<string, string | undefined> & {SERVE_OWNER: string};
export interface DownloadSample { step?: string; declaredBytes?: string; pendingBytes?: string; downloadPercent?: string }
export interface StepSample { clock?: string; detail?: string; setup?: string; fading?: boolean; elapsedMs?: number | null }
export interface StepBoundarySample {
  at?: number; elapsedMs?: number | null; fading?: boolean;
  rows?: readonly {key?: string; startedAt?: string; setupAtStart?: string}[];
}
/** Exact retained DOM facts at first entry, never reconstructed from samples. */
export function stepBoundaryEvidence(final: StepBoundarySample | null | undefined): {
  complete: boolean; reason: string | null; executedRows: number; measuredStarts: number;
  missingStarts: string[]; maxErrorPoints: number | null; within15Points: boolean | null;
  starts: {key: string; startedAt: number; setup: number; elapsedPercent: number; errorPoints: number}[];
};
/** First observed samples; monotonic ratios require a real panel clock origin. */
export function stepEvidence(samples: readonly StepSample[]): {
  numberedFrames: number; totalSteps: number | null; totalChanges: number; numberRegressions: number;
  observedStarts: { number: number; total: number; setup: number | null; elapsedPercent: number | null; errorPoints: number | null; pageElapsedPercent?: number; pageErrorPoints?: number | null }[];
  lastSetupBeforeFade: number | null;
};
export function compiledPollDetails<T extends {errors: readonly string[]}, U>(details: boolean, accuracy: T | null, measures: () => U): {accuracy: T | null; measures: U} | {errors: readonly string[]};
/** A visible boot fault stays fatal even without an injected accuracy recorder. */
export function compiledVisibleFailure(sample: {error?: string | null}, read: () => Promise<unknown>): Promise<{
  error: string; state: unknown; captureError?: string;
} | null>;
/** Callback coverage only; never painted-frame or L11 acceptance. */
export function admissionFrameEvidence(record: AdmissionFrames | undefined): {
  callbackRecordComplete: boolean; reason: string | null; observedFrames: number; blankFooterFrames: number | null;
};
export interface CompiledFrameWindow { controlsAt: number | null; last: number | null; worst: number; worstAt: number | null; frames: number; complete: boolean }
export function sampleCompiledFrame(state: CompiledFrameWindow, at: number, ready: boolean): void;
export function compiledFrameMetrics(state: CompiledFrameWindow | null | undefined, origin: number, tap: number): {
  controlsMs: number; controlsObservationIntervalMs: number; worstFrameAfterControlsMs: number; worstFrameAfterControlsAtMs: number | null;
  postControlsFrames: number; postControlsWindowMs: number; postControlsObservedMs: number;
};
export interface CompiledEntryQualification {
  frameLimitMs: 100; complete: boolean; passed: boolean; worstFrameAfterControlsMs: number | null; exitCode: 0 | 1 | 2;
}
export function compiledEntryQualification(rows: readonly {error?: string; worstFrameAfterControlsMs?: number}[]): CompiledEntryQualification;
export interface CompiledDocument { readonly origin: number; readonly documentToken?: string | null }
export interface CompiledTimingHistory { key: string; values: Record<string, number> | null; error?: string }
/** Bounded read-only evidence of the existing phone shardfile timing record. */
export function compiledTimingHistory(readDevice: () => string | null, identity: string): CompiledTimingHistory;
export function compiledDocumentEvidence(first: CompiledDocument, last: CompiledDocument): { token: string; timeOrigin: number; originDriftMs: number };
export function recoveredGridControls(sample: {
  readonly bootEntry?: { readonly reason?: string; readonly saved?: boolean; readonly continuing?: boolean; readonly grid?: boolean } | null;
  readonly world?: { readonly entered?: boolean; readonly paused?: boolean; readonly frameGate?: boolean } | null;
  readonly loaderVisible?: boolean; readonly title?: boolean; readonly error?: string | null;
  readonly origin?: number; readonly at?: number;
} | null): boolean;
export function requireCompiledEntry(href: string, shard: string, accuracy: { readyAt: number; errors: string[]; final: { path?: string } | null }): void;
export function downloadEvidence(samples: readonly DownloadSample[]): { measuredFrames: number; missingFrames: number; denominatorChangesAfterAdmission: number; downloadDrops: number; maxPercentError: number | null; finalDeclaredBytes: number | null };
export function transportEvidence(receipts: readonly { bodyBytes: number; decodedBodyBytes?: number | null }[]): {
  wireBodyBytes: number; networkContentBytes: number | null; unknownContentResponses: number; responses: number; expectedUnit: string; observedUnit: string;
};

/** Observe one native worker candidate; replacement, retirement and timeout refuse. */
export function waitForWaitingWorker<T extends { readonly state: ServiceWorkerState }>(registration: { readonly waiting: T | null; readonly installing: T | null }, timeoutMs?: number): Promise<T>;
