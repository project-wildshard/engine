import { pageScope } from '../../../shared/engine/app/resources';
import { saveStorage } from '../saves/slots';
import { apiUrl } from './apiOrigin';
import { installSaveReporter } from '../../../shared/engine/saves/runtime';
import type { SchemaFailure } from '../../../shared/engine/saves/store';
/**
 * Client error reports (E133, FINISH-LINE S2): every error the game hits reaches the server (api/errors.ts), and from
 * there `pnpm inbox:pull` → `.review/inbox/` as category `error`.
 *
 *   const r = new ErrorReporter({ send, context, ... });   // src/client/engine/ui/ErrorModal.ts wires the real one at boot
 *   await r.report('crabs', err, { disabled: true })        // → 'sent' | 'queued' | 'dup' | 'dropped'
 *   r.flushQueue()                                           // on `online` and at boot: send what an offline page queued
 *
 * - **Dedupe:** one report per message + stack per session (sessionStorage, so a reload-in-place doesn't resend it).
 *   A new error waits REPORT_DELAY_MS before it goes, so the repeats of the same frame-loop throw arrive as its `count`
 *   and a system switched off a few frames later arrives as `disabled`. A fatal one goes at once (the page may reload).
 * - **Rate limit:** at most REPORTS_MAX reports per session, sent or queued.
 * - **Offline:** a send that fails on the network (or a 429 / 5xx) waits in localStorage (QUEUE_MAX, newest kept) and
 *   goes on the next `online` / boot. A 4xx other than 429 is dropped: the server said the report itself is wrong.
 *
 * Pure (no DOM): storage, the clock, the timer and the transport are injected, so test/error-report.test.ts drives it
 * (`sendReport` below is the real transport the pages inject).
 */
import { describeError } from '../../../shared/engine/core/faults';
import { captureBrowserError, type BrowserErrorTags } from '../telemetry/browserErrors';

export interface LoadFailure {
  readonly kind: string;
  readonly context: Record<string, ContextValue>;
  readonly tags: BrowserErrorTags;
  readonly name: string;
  readonly build: string;
  readonly stage: string;
  readonly message: string;
  readonly stack: string;
}


export const REPORTS_MAX = 10;
export const QUEUE_MAX = 10;
export const REPORT_DELAY_MS = 3000;
/** sessionStorage: `{ n, keys }` — reports this session and the dedupe keys already sent (not `ws.`: the save mirror copies ws.*) */
export const SESSION_KEY = 'err.session';
/** localStorage: reports waiting for the network */
export const QUEUE_KEY = 'err.queue';

export type ContextValue = string | number | boolean | number[] | null;
export interface ErrorPayload {
  system: string;
  message: string;
  stack: string;
  count: number;
  fatal: boolean;
  disabled: boolean;
  sinceBootMs: number;
  context: Record<string, ContextValue>;
}
export type SendResult = 'ok' | 'retry' | 'reject';
export type ReportOutcome = 'sent' | 'queued' | 'dup' | 'dropped';
export interface StorageLike { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }

export interface ReporterDeps {
  send: (p: ErrorPayload) => Promise<SendResult>;
  context: () => Record<string, ContextValue>;
  session?: StorageLike | null;
  local?: StorageLike | null;
  /** ms since boot */
  now?: () => number;
  /** a timer: (fn, ms) */
  later?: (fn: () => void, ms: number) => void;
  delayMs?: number;
}

interface Pending { payload: ErrorPayload; waiters: ((o: ReportOutcome) => void)[]; timer: boolean }

/** a short stable hash of the dedupe key (djb2): the session keeps these, not whole stacks */
export function keyOf(message: string, stack: string): string {
  const s = `${message}\n${stack.slice(0, 1500)}`;
  let h = 5381;
  for (const ch of s) h = ((h * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  return h.toString(36);
}

export class ErrorReporter {
  private readonly deps: Required<Omit<ReporterDeps, 'session' | 'local'>> & { session: StorageLike | null; local: StorageLike | null };
  private readonly pending = new Map<string, Pending>();
  /** keys sent (or queued) this session → a later repeat only counts locally */
  private sentKeys = new Set<string>();
  private reports = 0;
  private flushing = false;

  constructor(deps: ReporterDeps) {
    this.deps = {
      session: null, local: null,
      now: () => 0,
      later: (fn, ms) => { pageScope.timeout(ms, fn); }, // the page's retry, not a shard's (src/shared/engine/app/ownership.ts)
      delayMs: REPORT_DELAY_MS,
      ...deps,
    };
    try {
      const raw = this.deps.session?.getItem(SESSION_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { n?: unknown; keys?: unknown };
        this.reports = typeof v.n === 'number' ? v.n : 0;
        if (Array.isArray(v.keys)) for (const k of v.keys) if (typeof k === 'string') this.sentKeys.add(k);
      }
    } catch { /* a fresh session */ }
  }

  /** reports used this session (sent or queued) */
  get used(): number { return this.reports; }

  /** Report one error. Resolves once it is on the server ('sent'), waiting offline ('queued'), a repeat ('dup') or over the cap ('dropped'). */
  report(system: string, error: unknown, flags: { fatal?: boolean; disabled?: boolean } = {}): Promise<ReportOutcome> {
    const { message, stack } = describeError(error);
    const key = keyOf(message, stack);
    const p = this.pending.get(key);
    if (p) { // the same error again before it went: fold it in
      p.payload.count++;
      if (flags.disabled === true) p.payload.disabled = true;
      if (flags.fatal === true) { p.payload.fatal = true; this.go(key); }
      return new Promise((resolve) => { p.waiters.push(resolve); });
    }
    if (this.sentKeys.has(key)) return Promise.resolve('dup');
    if (this.reports >= REPORTS_MAX) return Promise.resolve('dropped');
    this.reports++;
    this.sentKeys.add(key);
    this.saveSession();
    let context: Record<string, ContextValue> = {};
    try { context = this.deps.context(); } catch { /* a report without context beats none */ }
    const payload: ErrorPayload = {
      system, message: message.slice(0, 500), stack: stack.slice(0, 4000), count: 1,
      fatal: flags.fatal === true, disabled: flags.disabled === true, sinceBootMs: Math.round(this.deps.now()), context,
    };
    const entry: Pending = { payload, waiters: [], timer: false };
    this.pending.set(key, entry);
    const done = new Promise<ReportOutcome>((resolve) => { entry.waiters.push(resolve); });
    if (payload.fatal) this.go(key);
    else { entry.timer = true; this.deps.later(() => { this.go(key); }, this.deps.delayMs); }
    return done;
  }

  /** send one pending report now */
  private go(key: string): void {
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    void (async () => { const o = await this.deliver(p.payload); for (const w of p.waiters) w(o); })();
  }

  /** the transport, a throw read as 'retry' (offline) */
  private async trySend(p: ErrorPayload): Promise<SendResult> {
    try { return await this.deps.send(p); } catch { return 'retry'; }
  }

  private async deliver(payload: ErrorPayload): Promise<ReportOutcome> {
    const r = await this.trySend(payload);
    if (r === 'ok') { void this.flushQueue(); return 'sent'; } // the network is back: whatever waited goes too
    if (r === 'reject') return 'dropped';
    this.enqueue(payload);
    return 'queued';
  }

  // ── the offline queue ──
  readQueue(): ErrorPayload[] {
    try {
      const raw = this.deps.local?.getItem(QUEUE_KEY);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? (v as ErrorPayload[]) : [];
    } catch { return []; }
  }
  private writeQueue(q: readonly ErrorPayload[]): void {
    try {
      if (q.length === 0) this.deps.local?.removeItem(QUEUE_KEY);
      else this.deps.local?.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
    } catch { /* storage full: this one is lost */ }
  }
  private enqueue(p: ErrorPayload): void { this.writeQueue([...this.readQueue(), p]); }

  /** Send every queued report (oldest first); stops at the first that still can't go. Returns how many went. */
  async flushQueue(): Promise<number> {
    if (this.flushing) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      let q = this.readQueue();
      while (q.length > 0) {
        const [head, ...rest] = q;
        if (head === undefined) break;
        const r = await this.trySend(head);
        if (r === 'retry') break;
        if (r === 'ok') sent++;
        q = rest;
        this.writeQueue(q);
      }
    } finally { this.flushing = false; }
    return sent;
  }

  private saveSession(): void {
    try { this.deps.session?.setItem(SESSION_KEY, JSON.stringify({ n: this.reports, keys: [...this.sentKeys].slice(-50) })); } catch { /* not remembered: may resend after a reload */ }
  }
}

const ERRORS_URL = apiUrl('errors');

/** The real transport (src/client/engine/ui/ErrorModal.ts, src/client/engine/boot/stuck.ts): one POST to api/errors.ts. */
let sentId = '';
/** QB8: the id `/api/errors` gave the latest report it stored ('' before one), shown in the error modal's details */
export function lastReportId(): string { return sentId; }
export async function sendReport(p: ErrorPayload): Promise<SendResult> {
  const res = await fetch(ERRORS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), keepalive: true });
  if (res.ok) {
    try { const body: unknown = await res.json(); const id: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'id') : undefined; if (typeof id === 'string') sentId = id; } catch { /* stored without a readable id */ }
    return 'ok';
  }
  return res.status === 429 || res.status >= 500 ? 'retry' : 'reject';
}

/** The URL for a report: no fragment, and nothing that looks like a secret. */
export function safeUrl(href: string): string {
  try {
    const u = new URL(href);
    u.hash = '';
    for (const k of new Set(u.searchParams.keys())) if (/pass|token|secret|key|auth/iu.test(k)) u.searchParams.delete(k);
    return u.toString().slice(0, 500);
  } catch { return ''; }
}

/** Fatal level loads use the existing durable inbox queue and the configured Sentry channel. */
/** `capture`: where the error goes besides the queue (the browser error tracker by default; a test observes its own) */
export function reportError(failure: LoadFailure | SchemaFailure, capture: (error: Error, tags: BrowserErrorTags) => void = captureBrowserError): Promise<ReportOutcome> {
  if ('issue' in failure) {
    return reportError({ kind: failure.kind, context: { scope: failure.scope, key: failure.key, version: failure.version, issue: failure.issue }, tags: { system: failure.kind, build: '', shard: failure.scope, bootStage: 'save', fatal: false }, name: failure.key, build: '', stage: 'save', message: `${failure.scope}/${failure.key} v${failure.version}: ${failure.issue}`, stack: '' }, capture);
  }
  const error = new Error(failure.message);
  error.stack = failure.stack;
  capture(error, failure.tags);
  const storage = (name: 'device' | 'session'): ReturnType<typeof saveStorage> => saveStorage(name);
  const reporter = new ErrorReporter({
    send: sendReport, session: storage('session'), local: storage('device'),
    context: () => failure.context,
    now: () => performance.now(),
  });
  return reporter.report(failure.kind, error, { fatal: failure.kind !== 'save-schema' });
}

installSaveReporter((failure) => { void reportError(failure).catch(() => { /* retained by the durable reporter */ }); });
