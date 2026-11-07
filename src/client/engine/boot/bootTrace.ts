import { pageScope } from '../../../shared/engine/app/resources';
import { saveStorage } from '../saves/slots';
/** A small durable breadcrumb for an enabled level boot. A terminated WebContent process cannot run a final handler. */
import { deliverBrowserError } from '../telemetry/browserErrors';
import type { ProgressView } from './plan';

declare const __BUILD_ID__: string;

const KEY = 'boot.trace';
const RECENT_MS = 5 * 60_000;
const HISTORY_LIMIT = 32;
const REPORT_KEY = 'boot.reports'; // diagnostic evidence is not part of the native save mirror
const REPORT_LIMIT = 4;
const REPORT_MAX_AGE = 7 * 24 * 60 * 60_000;
type Status = 'in_progress' | 'ready' | 'planned' | 'handled_error' | 'context_lost' | 'pagehide';
type Facts = Record<string, string | number | boolean | null>;
interface Checkpoint { atMs: number; operation: string; facts: Facts }

interface BootRecord {
  levelId: string;
  levelName: string;
  id: string;
  build: string;
  startedAt: number;
  updatedAt: number;
  stage: string;
  setup: number;
  download: number;
  visibility: string;
  status: Status;
  detail?: string;
  checkpoints?: Checkpoint[];
}

/** where an interrupted boot's evidence goes: the review inbox and the browser error tracker */
export interface BootTraceTransports {
  inbox: (error: Error, build: string, diagnostic: string, system: string, level: string) => Promise<string>;
  deliver: typeof deliverBrowserError;
}
const PAGE_TRANSPORTS: BootTraceTransports = {
  inbox: async (error, build, diagnostic, system, level) => (await import('../telemetry/bootInbox')).reportBootInterruption(error, build, diagnostic, system, level),
  deliver: deliverBrowserError,
};

/** one page's boot trace (createBootTrace) */
export interface BootTrace {
  bootTraceActive: () => boolean;
  previousBootLevel: () => string;
  flushBootReports: () => Promise<void>;
  inspectPreviousBoot: () => void;
  previousBootLine: () => string;
  bootDiagnostic: () => Record<string, unknown>;
  bootDiagnosticJson: () => string;
  recordBootProgress: (view: ProgressView) => void;
  recordBootCheckpoint: (operation: string, facts?: Facts) => void;
  startBoot: (level: { id: string; name: string }, enabled?: boolean) => void;
  markBootPlanned: () => void;
  markBootHandledError: () => void;
  markBootContextLost: () => void;
  beginExploreEntry: (mode: string) => void;
  endExploreEntry: () => void;
  exploreEntryPending: () => boolean;
  recordExploreFrame: () => void;
  recordGpuRecovery: (reason: string) => void;
}

/**
 * One page's boot trace over its transports. The page has one (below); a test builds one per simulated page load with
 * its own transports instead of reloading the module and mocking them (E422).
 */
export function createBootTrace(transports: BootTraceTransports = PAGE_TRANSPORTS): BootTrace {
  let current: BootRecord | null = null;
  let previousLine = '';
  let previousLevelId = '';
  function bootTraceActive(): boolean { return current?.status === 'in_progress'; }
  function previousBootLevel(): string { return previousLevelId; }
  let transition: { frames: number; firstDrawAt: number | null } | null = null;
  let hiddenStatus: Status | null = null;
  interface PendingReport { record: BootRecord; reason: string; inbox: boolean; sentry: boolean }
  let flushing = false;
  let retryListener = false;

  function reports(): PendingReport[] {
    try {
      const raw: unknown = JSON.parse(storage()?.getItem(REPORT_KEY) ?? '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((item: unknown): item is PendingReport => {
        if (typeof item !== 'object' || item === null) return false;
        const p = item as Partial<PendingReport>;
        return typeof p.reason === 'string' && typeof p.inbox === 'boolean' && typeof p.sentry === 'boolean' &&
          validRecord(p.record) && Date.now() - p.record.updatedAt < REPORT_MAX_AGE;
      }).slice(-REPORT_LIMIT);
    } catch { return []; }
  }
  function saveReports(queue: PendingReport[]): boolean {
    try {
      const local = storage();
      if (!local) return false;
      local.setItem(REPORT_KEY, JSON.stringify(queue.slice(-REPORT_LIMIT)));
      return true;
    } catch { return false; }
  }
  function enqueue(record: BootRecord, reason: string): boolean {
    const queue = reports();
    if (!queue.some((p) => p.record.id === record.id)) queue.push({ record, reason, inbox: false, sentry: false });
    return saveReports(queue);
  }
  function reportLine(prior: BootRecord, reason: string): string {
    if (reason) return `${prior.levelName} graphics recovery: ${reason}`;
    const stage = prior.stage.replaceAll(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const last = prior.checkpoints?.at(-1)?.operation ?? prior.detail ?? '';
    return `Abrupt previous page: ${prior.levelName} ${stage} ${prior.setup}% setup / ${prior.download}% download${last ? ` at ${last}` : ''} (cause unknown)`;
  }

  /** Retry independent channels from the renderer-free title; retain evidence until each one acknowledges it. */
  async function flushBootReports(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      for (const pending of reports()) {
        const prior = pending.record;
        const system = pending.reason ? 'gpu-recovery' : 'boot-abrupt';
        const diagnostic = { previousBuild: prior.build, attempt: prior.id, stage: prior.stage, detail: prior.detail ?? '',
          elapsedMs: prior.updatedAt - prior.startedAt, visibility: prior.visibility, checkpoints: prior.checkpoints ?? [] };
        const message = `${reportLine(prior, pending.reason)}; previous build ${prior.build}; visibility ${prior.visibility}`;
        const acknowledge = (channel: 'inbox' | 'sentry'): void => {
          const queue = reports();
          const entry = queue.find((p) => p.record.id === prior.id);
          if (entry) entry[channel] = true;
          saveReports(queue.filter((p) => !p.inbox || !p.sentry));
        };
        await Promise.all([
          pending.inbox ? Promise.resolve() : Promise.resolve().then(async () => {
            const result = await transports.inbox(new Error(message), prior.build,
              JSON.stringify({ ...diagnostic, checkpoints: diagnostic.checkpoints.slice(-8) }), system, prior.levelId);
            if (result === 'ok' || result === 'reject') acknowledge('inbox');
            return undefined;
          }).catch(() => { /* leave durable evidence for the next online event or document */ }),
          pending.sentry ? Promise.resolve() : transports.deliver(new Error(message), {
            system, build: prior.build, shard: prior.levelId, bootStage: prior.stage, fatal: false, diagnostic,
          }).then((ok) => { if (ok) acknowledge('sentry'); return undefined; }).catch(() => { /* independently retry Sentry */ }),
        ]);
      }
    } finally { flushing = false; }
  }

  function storage(): ReturnType<typeof saveStorage> | null { return saveStorage('device'); }
  function read(key: string): BootRecord | null {
    try {
      const value: unknown = JSON.parse(storage()?.getItem(key) ?? 'null');
      if (!validRecord(value)) return null;
      const o = value;
      // Older builds have neither detail nor checkpoints. Ignore malformed optional evidence.
      return { ...o, detail: typeof o.detail === 'string' ? o.detail.slice(0, 200) : '',
        checkpoints: Array.isArray(o.checkpoints) ? o.checkpoints.filter(validCheckpoint).slice(-HISTORY_LIMIT) : [] };
    } catch { return null; }
  }
  function validRecord(value: unknown): value is BootRecord {
    if (typeof value !== 'object' || value === null) return false;
    const o = value as Partial<BootRecord>;
    return typeof o.levelId === 'string' && typeof o.levelName === 'string' && typeof o.id === 'string' && typeof o.build === 'string' && typeof o.startedAt === 'number' &&
      typeof o.updatedAt === 'number' && typeof o.stage === 'string' && typeof o.setup === 'number' &&
      typeof o.download === 'number' && typeof o.visibility === 'string' && typeof o.status === 'string' &&
      (o.checkpoints === undefined || (Array.isArray(o.checkpoints) && o.checkpoints.every(validCheckpoint)));
  }
  function validCheckpoint(value: unknown): value is Checkpoint {
    if (typeof value !== 'object' || value === null) return false;
    const c = value as Partial<Checkpoint>;
    const facts: unknown = c.facts;
    return typeof c.atMs === 'number' && Number.isFinite(c.atMs) && typeof c.operation === 'string' &&
      typeof facts === 'object' && facts !== null && !Array.isArray(facts) &&
      Object.values(facts).every((v: unknown) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)));
  }
  function write(key: string, value: BootRecord): void { try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ } }
  function update(status: Status): void {
    if (current?.status !== 'in_progress') return;
    current = { ...current, status, stage: status === 'ready' ? 'world ready' : current.stage, updatedAt: Date.now(), visibility: document.visibilityState };
    write(KEY, current);
  }

  /** Called by lastEnd on every new document, before its own boot can replace the old record. */
  function inspectPreviousBoot(): void {
    if (!retryListener && typeof window !== 'undefined') {
      retryListener = true;
      pageScope.listen(window, 'online', () => { void flushBootReports(); });
    }
    const prior = read(KEY);
    if (prior?.status === 'in_progress' && prior.visibility === 'visible') {
      const age = Date.now() - prior.updatedAt;
      if (age >= 0 && age <= RECENT_MS) {
        previousLine = reportLine(prior, '');
        previousLevelId = prior.levelId;
        // Copy before replacing the active attempt; a failed import/fetch can retry after another launch.
        if (enqueue(prior, '')) {
          try { storage()?.removeItem(KEY); } catch { /* enqueue deduplicates the same attempt */ }
        }
      }
    }
    if (!previousLine) {
      const latest = reports().at(-1);
      if (latest) {
        previousLine = reportLine(latest.record, latest.reason);
        previousLevelId = latest.record.levelId;
      }
    }
    void flushBootReports();
  }

  /** Shown in the loader and the Loading & memory Debug row after a restart. */
  function previousBootLine(): string {
    return previousLine;
  }

  /** The same bounded evidence also accompanies handled errors through the working first-party inbox. */
  function bootDiagnostic(): Record<string, unknown> {
    if (current === null) return {};
    return { attempt: current.id, previousBuild: current.build, stage: current.stage, detail: current.detail ?? '',
      elapsedMs: current.updatedAt - current.startedAt, status: current.status, checkpoints: current.checkpoints ?? [] };
  }

  /** Keep the server's 16 KiB request budget: newest operations matter most for a handled failure. */
  function bootDiagnosticJson(): string {
    if (current === null) return '';
    return JSON.stringify({ ...bootDiagnostic(), checkpoints: (current.checkpoints ?? []).slice(-8) });
  }

  /** Persist only stage changes and coarse first-frame progress, never every boot-plan paint. */
  function recordBootProgress(view: ProgressView): void {
    if (current === null) return;
    if (current.status !== 'in_progress') return;
    // Arrival can open Explore before the loader emits its final progress notification.
    if (transition) { if (view.error) update('handled_error'); return; }
    const stage = view.done ? 'boot plan complete' : view.step;
    const setup = Math.floor(view.setup * 100);
    const download = Math.floor(view.download * 100);
    const firstFrameCheckpoint = stage === 'firstFrame' && Math.floor(setup / 5) > Math.floor(current.setup / 5);
    const detail = view.detail.slice(0, 200);
    if (stage === current.stage && detail === current.detail && !firstFrameCheckpoint && !view.error) return;
    current = { ...current, stage, detail, setup, download, updatedAt: Date.now(), visibility: document.visibilityState };
    write(KEY, current);
    if (view.error) update('handled_error');
  }

  /** Synchronous, bounded evidence written BEFORE risky GPU work, surviving a process termination. */
  function recordBootCheckpoint(operation: string, facts: Facts = {}): void {
    if (current?.status !== 'in_progress') return;
    const now = Date.now();
    const checkpoint: Checkpoint = { atMs: now - current.startedAt, operation, facts };
    current = { ...current, updatedAt: now, checkpoints: [...(current.checkpoints ?? []), checkpoint].slice(-HISTORY_LIMIT) };
    write(KEY, current);
  }

  /** Begin once an enabled level loader exists; the root title has no boot in progress. */
  function startBoot(level: { id: string; name: string }, enabled = true): void {
    if (!enabled) return;
    transition = null;
    hiddenStatus = null;
    const now = Date.now();
    current = {
      levelId: level.id, levelName: level.name,
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, build: __BUILD_ID__, startedAt: now,
      updatedAt: now, stage: 'loader', setup: 0, download: 0, visibility: document.visibilityState, status: 'in_progress',
    };
    write(KEY, current);
    pageScope.listen(document, 'ws:ready', () => { if (!transition) update('ready'); }, { once: true });
    pageScope.listen(document, 'visibilitychange', () => {
      if (!current) return;
      if (document.visibilityState === 'visible' && current.status === 'pagehide' && hiddenStatus) {
        current = { ...current, status: hiddenStatus }; hiddenStatus = null;
      }
      if (current.status !== 'in_progress') return;
      if (transition) { transition.frames = 0; transition.firstDrawAt = null; }
      current = { ...current, updatedAt: Date.now(), visibility: document.visibilityState };
      write(KEY, current);
    });
    pageScope.listen(window, 'pagehide', () => {
      if (current?.status === 'in_progress') hiddenStatus = current.status;
      if (transition) { transition.frames = 0; transition.firstDrawAt = null; }
      update('pagehide');
    });
    pageScope.listen(window, 'pageshow', (e) => {
      if (!e.persisted || current?.status !== 'pagehide' || !hiddenStatus) return;
      current = { ...current, status: hiddenStatus, updatedAt: Date.now(), visibility: document.visibilityState };
      hiddenStatus = null;
      write(KEY, current);
    });
  }

  function markBootPlanned(): void { update('planned'); }
  function markBootHandledError(): void { update('handled_error'); }
  function markBootContextLost(): void { update('context_lost'); }

  /** Explore imports, construction and a newly exposed vista can fail after ws:ready. */
  function beginExploreEntry(mode: string): void {
    if (!current || (current.status !== 'ready' && current.status !== 'in_progress')) return;
    current = { ...current, status: 'in_progress', stage: `explore:${mode.slice(0, 20)}`, updatedAt: Date.now(), visibility: document.visibilityState };
    transition = { frames: 0, firstDrawAt: null };
    recordBootCheckpoint('explore:entry', { mode: mode.slice(0, 20) });
  }

  /** A successful in-page exit ends the entry watch; a handled/lost attempt must keep its terminal status. */
  function endExploreEntry(): void {
    if (!transition || current?.status !== 'in_progress') return;
    recordBootCheckpoint('explore:left');
    transition = null;
    update('ready');
  }

  function exploreEntryPending(): boolean { return transition !== null && current?.status === 'in_progress'; }

  /** Called after a real successful draw, not a timer; only coarse milestones touch storage. */
  function recordExploreFrame(): void {
    if (!transition || current?.status !== 'in_progress' || document.visibilityState !== 'visible') return;
    transition.firstDrawAt ??= Date.now();
    transition.frames++;
    if (transition.frames === 1 || transition.frames === 30) recordBootCheckpoint('explore:drawn', { frames: transition.frames });
    if (transition.frames >= 120 && Date.now() - transition.firstDrawAt >= 10_000) {
      recordBootCheckpoint('explore:stable', { frames: transition.frames });
      transition = null;
      update('ready');
    }
  }

  /** A known failure survives markUnload/pagehide, including a failure after the world became stable. */
  function recordGpuRecovery(reason: string): void {
    if (!current) return;
    current = { ...current, updatedAt: Date.now(), visibility: document.visibilityState };
    const checkpoint: Checkpoint = { atMs: current.updatedAt - current.startedAt, operation: 'gpu:recovery', facts: { reason: reason.slice(0, 200) } };
    current = { ...current, checkpoints: [...(current.checkpoints ?? []), checkpoint].slice(-HISTORY_LIMIT) };
    // Copy synchronously before navigation. The static title sends it on the next document.
    enqueue(current, reason.slice(0, 200));
  }
  return { bootTraceActive, previousBootLevel, flushBootReports, inspectPreviousBoot, previousBootLine, bootDiagnostic, bootDiagnosticJson, recordBootProgress, recordBootCheckpoint, startBoot, markBootPlanned, markBootHandledError, markBootContextLost, beginExploreEntry, endExploreEntry, exploreEntryPending, recordExploreFrame, recordGpuRecovery };
}

/** the page's boot trace */
const page = createBootTrace();
export const bootTraceActive: BootTrace['bootTraceActive'] = page.bootTraceActive;
export const previousBootLevel: BootTrace['previousBootLevel'] = page.previousBootLevel;
export const flushBootReports: BootTrace['flushBootReports'] = page.flushBootReports;
export const inspectPreviousBoot: BootTrace['inspectPreviousBoot'] = page.inspectPreviousBoot;
export const previousBootLine: BootTrace['previousBootLine'] = page.previousBootLine;
export const bootDiagnostic: BootTrace['bootDiagnostic'] = page.bootDiagnostic;
export const bootDiagnosticJson: BootTrace['bootDiagnosticJson'] = page.bootDiagnosticJson;
export const recordBootProgress: BootTrace['recordBootProgress'] = page.recordBootProgress;
export const recordBootCheckpoint: BootTrace['recordBootCheckpoint'] = page.recordBootCheckpoint;
export const startBoot: BootTrace['startBoot'] = page.startBoot;
export const markBootPlanned: BootTrace['markBootPlanned'] = page.markBootPlanned;
export const markBootHandledError: BootTrace['markBootHandledError'] = page.markBootHandledError;
export const markBootContextLost: BootTrace['markBootContextLost'] = page.markBootContextLost;
export const beginExploreEntry: BootTrace['beginExploreEntry'] = page.beginExploreEntry;
export const endExploreEntry: BootTrace['endExploreEntry'] = page.endExploreEntry;
export const exploreEntryPending: BootTrace['exploreEntryPending'] = page.exploreEntryPending;
export const recordExploreFrame: BootTrace['recordExploreFrame'] = page.recordExploreFrame;
export const recordGpuRecovery: BootTrace['recordGpuRecovery'] = page.recordGpuRecovery;
