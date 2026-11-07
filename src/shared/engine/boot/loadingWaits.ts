/**
 * The page's loading-wait registry (P1-E1): plain data any host can keep, with no DOM. A browser page installs it on
 * `document` from its first script (`download.ts` adopts that inline wait for the module download); a bare host keeps it
 * on `globalThis`. Boot waits (`waits.ts`) and the loading card read the same registry.
 */
import { diagnosticNow } from '../core/clock';

export type LoadingWaitKind = 'work' | 'file' | 'admission' | 'worker' | 'wasm' | 'shader';
/** One live operation, from first HTML through runtime adoption. Bytes describe
 * observed activity only; they never credit the verified download ledger. */
export interface LoadingWaitEntry {
  id: number; label: string; kind: LoadingWaitKind; step: string | null; owner: symbol | null;
  startedAt: number; progressAt: number; loadedBytes: number; totalBytes: number | null;
  retry: (() => void) | null; progress: string; inline: boolean;
  /** False for an in-place transport retry; older document reload actions omit it. */
  retryNavigation?: boolean;
  /** Exact transport identity for diagnostics; never the human work caption. */
  resource?: string;
}
export interface LoadingWaitState { version: 1; sequence: number; pending: Map<number, LoadingWaitEntry> }
const loadingWaitKey = Symbol.for('engine.loading.waits.v1');
function isLoadingWaitState(value: unknown): value is LoadingWaitState {
  return typeof value === 'object' && value !== null && 'version' in value && value.version === 1
    && 'sequence' in value && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence)
    && 'pending' in value && Object.prototype.toString.call(value.pending) === '[object Map]';
}
/** The object the registry hangs on: the first document, read as an opaque key so a host without one uses its global. */
function waitCarrier(): object {
  const carrier: unknown = Reflect.get(globalThis, 'document');
  return typeof carrier === 'object' && carrier !== null ? carrier : globalThis;
}
/** The first-document script installs this exact data contract. Bare harnesses
 * create it on first use; importing the module installs no service. */
export function loadingWaitState(target: object = waitCarrier()): LoadingWaitState {
  const value: unknown = Reflect.get(target, loadingWaitKey);
  if (value !== undefined) {
    if (!isLoadingWaitState(value)) throw new Error('Invalid loading wait registry');
    return value;
  }
  const state: LoadingWaitState = { version: 1, sequence: 0, pending: new Map() };
  Reflect.set(target, loadingWaitKey, state); return state;
}
export type LoadingWaitOptions = Partial<Pick<LoadingWaitEntry, 'kind' | 'step' | 'owner' | 'startedAt' | 'progressAt' | 'loadedBytes' | 'totalBytes' | 'retry' | 'inline' | 'resource' | 'retryNavigation'>>;
/** Register work without changing its lifetime or concurrency. Only an explicit
 * failed-operation callback offers RETRY; pending work never implies reload. */
export function beginLoadingWait(label: string, options: LoadingWaitOptions = {}): number {
  const state = loadingWaitState(), id = ++state.sequence, now = diagnosticNow();
  state.pending.set(id, { id, label, kind: options.kind ?? 'work', step: options.step ?? null, owner: options.owner ?? null,
    startedAt: options.startedAt ?? now, progressAt: options.progressAt ?? now, loadedBytes: options.loadedBytes ?? 0,
    totalBytes: options.totalBytes ?? null, retry: options.retry ?? null,
    progress: '', inline: options.inline ?? false, ...(options.resource === undefined ? {} : {resource: options.resource}),
    ...(options.retryNavigation === undefined ? {} : {retryNavigation: options.retryNavigation}) });
  return id;
}
/** Only real byte growth or a semantic progress-key change changes the reported progress age. */
export function reportLoadingWait(id: number, update: Partial<Pick<LoadingWaitEntry, 'label' | 'loadedBytes' | 'totalBytes' | 'progress' | 'owner' | 'step'>>, now: number = diagnosticNow()): void {
  const row = loadingWaitState().pending.get(id); if (row === undefined) return;
  if ((update.loadedBytes !== undefined && update.loadedBytes > row.loadedBytes)
    || (update.progress !== undefined && row.progress !== '' && update.progress !== row.progress)) row.progressAt = now;
  Object.assign(row, update);
}
export function finishLoadingWait(id: number): void { loadingWaitState().pending.delete(id); }
