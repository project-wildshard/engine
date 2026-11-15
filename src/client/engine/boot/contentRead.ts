import { Scope } from '../../../shared/engine/app/scope';
import { captureBrowserError, engineScreenTags } from '../telemetry/browserErrors';
import { beginLoadingWait, finishLoadingWait } from '../../../shared/engine/boot/loadingWaits';
import { currentLoadingTimeline } from '../../../shared/engine/boot/timeline';
import { bootProgress } from '../../../shared/engine/boot/timing';
import { diagnosticNow } from '../../../shared/engine/core/clock';

/** A missing or interrupted transport, never a parsed-content or admission refusal. */
export class ContentReadError extends Error {
  readonly url: string;
  /** RL8: the server answered that the file is not there (404, or the HTML fallback): a retry of the same URL can't help */
  readonly missing: boolean;
  /** FM6: the HTTP status the server answered, its `Retry-After` in ms (seconds or a date, at most 10 min), and whether the bytes
   *  arrived but failed their length check (mode 44). Null and false when not measured. */
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly broken: boolean;
  constructor(url: string, detail: string, cause?: unknown, missing = false, measured: { status?: number; retryAfterMs?: number | null; broken?: boolean } = {}) {
    super(`Read failed: ${new URL(url, 'https://content.invalid').pathname} · ${detail}`, { cause });
    this.name = 'ContentReadError'; this.url = url; this.missing = missing;
    this.status = measured.status ?? null; this.retryAfterMs = measured.retryAfterMs ?? null; this.broken = measured.broken ?? false;
  }
}
/** FM6 mode 34: a `Retry-After` of seconds or an HTTP date, in ms from `now`; anything else (or past 10 min) is no answer. */
export function contentRetryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const text = header.trim(), ms = /^\d{1,6}$/u.test(text) ? Number(text) * 1000 : /[a-z]/iu.test(text) ? Date.parse(text) - now : Number.NaN;
  return Number.isFinite(ms) && ms >= 0 && ms <= 600_000 ? Math.round(ms) : null;
}
/** The spawn book (`assets/spawn/packs-<build>.json`): mode 35 names it apart from the packs it lists. */
const BOOK = /(?:^|\/)assets\/spawn\/packs-[^/]+\.json$/u;
/** FM6: the catalogue's ids for a failed read, and the line a player reads (meta MMO-FAILURE-MODES-PLAN modes 33 to 35, 44). The
 *  address and raw detail stay in the error for Copy diagnostics. */
export function contentFailure(error: ContentReadError): { readonly failmode: string; readonly line: string } {
  const book = BOOK.test(new URL(error.url, 'https://content.invalid').pathname);
  if (book) return { failmode: 'book-5xx', line: 'The world\'s book didn\'t arrive' };
  if (error.status === 429) return { failmode: 'packs-429', line: 'Download paused · the server is busy' };
  if (error.broken) return { failmode: 'packs-5xx pack-broken', line: 'Download paused · a file didn\'t verify' };
  if (error.missing) return { failmode: 'packs-5xx', line: 'Download paused · a file isn\'t there' };
  if (error.status !== null) return { failmode: 'packs-5xx', line: 'Download paused · the server had an error' };
  return { failmode: 'packs-5xx', line: 'Download paused · the connection dropped' };
}
export interface ContentReadOptions {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  /** Actual chunks delivered, including an interrupted attempt; no verified-byte credit. */
  read?: (bytes: number) => void;
  /** Host retry acknowledgement. The browser default uses the existing loading-card button. */
  retry?: (error: ContentReadError) => Promise<void>;
  /** First-party immutable reads trust the server; stale lengths retry the same URL. */
  expectedBytes?: number;
  /** Header-admitted native response before reading; the caller owns any clone. */
  response?: (response: Response) => void;
  /** An optional file: a server that answers it is not there (404, the HTML fallback) throws at once instead of RETRY. */
  missingThrows?: boolean;
  /** OF17: asked when the read has failed twice, before it waits on RETRY. True throws the error instead: the caller has
   *  another copy to read (a texture's other form, held in the cache). */
  instead?: (error: ContentReadError) => Promise<boolean>;
}

function html(bytes: Uint8Array): boolean {
  return /^\s*<(?:!doctype\s+html\b|html(?:\s|>))/iu.test(new TextDecoder().decode(bytes.subarray(0, 128)));
}
async function body(response: Response, url: string, maximum: number, read?: (bytes: number) => void, expected?: number,
  received?: (response: Response) => void): Promise<Uint8Array<ArrayBuffer>> {
  const sizeError = (): Error => expected === undefined ? new Error('Content wire size exceeds cap')
    : new ContentReadError(url, 'byte length differs from manifest', undefined, false, { broken: true });
  if (!response.ok || /\btext\/html\b/iu.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => undefined);
    throw new ContentReadError(url, response.ok ? 'missing content (HTML response)' : `HTTP ${response.status}`, undefined, response.ok || response.status === 404,
      response.ok ? {} : { status: response.status, retryAfterMs: contentRetryAfterMs(response.headers.get('retry-after')) });
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) {
    await response.body?.cancel().catch(() => undefined);
    throw sizeError();
  }
  received?.(response);
  if (response.body === null) {
    if (expected !== undefined && expected !== 0) throw sizeError();
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  let bytes = new Uint8Array(length === null ? Math.min(maximum, 65536) : Number(length)), size = 0;
  try {
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await reader.read(); }
      catch (error) { throw new ContentReadError(url, 'connection interrupted', error); }
      if (part.done) break;
      const next = size + part.value.byteLength;
      if (next > maximum) throw sizeError();
      if (next > bytes.length) {
        const grown = new Uint8Array(Math.min(maximum, Math.max(next, bytes.length * 2)));
        grown.set(bytes); bytes = grown;
      }
      bytes.set(part.value, size); size = next;
      bootProgress(`download:${url}`, part.value.byteLength, expected ?? null, 'decoded-body-bytes');
      read?.(part.value.byteLength);
    }
  } catch (error) {
    // A caller may own a clone. Cancelling a tee waits for both branches;
    // do not deadlock recovery before the caller can retire its failed clone.
    void reader.cancel().catch(() => undefined); throw error;
  }
  const result = size === bytes.length ? bytes : bytes.slice(0, size);
  if (html(result)) throw new ContentReadError(url, 'missing content (HTML response)', undefined, true);
  if (expected !== undefined && size !== expected) throw sizeError();
  return result;
}

function abortReason(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('Content read cancelled', 'AbortError');
}
const retryGroups = new WeakMap<Document, Set<() => void>>();
/** QA 11-12 row 36 (the Open Plots offline audit): at START the card is still the boot shell, and nothing paints a wait's RETRY
 *  until Loading takes it over, so an offline START read waited on a button nobody could see. The shell's own button shows, with
 *  the failed file on its foot line; once Loading owns the card it repaints both from the same wait. */
function shellRetry(scope: Scope, error: ContentReadError, retry: () => void): void {
  const button = document.querySelector<HTMLButtonElement>('.ws-load .ws-load-retry');
  if (button === null) return;
  const foot = document.querySelector<HTMLElement>('.ws-load [data-el="foot"]');
  if (foot !== null) foot.textContent = error.message;
  button.hidden = false;
  scope.listen(button, 'click', retry);
}
/** pages whose card has offered RETRY once already: RETRY rounds while still offline must not fill the screen outbox (8 kept) */
const stallReported = new WeakSet<Document>();
/** SENTRY-TRIAGE S18: the card's RETRY is a screen of a fault; its first offer on this page reports, once, at warning level */
function reportStall(target: Document, error: ContentReadError, step: string | null): void {
  if (stallReported.has(target)) return;
  stallReported.add(target);
  try { captureBrowserError(error, engineScreenTags('loading-stall', 'content-read', step ?? 'loading', { url: error.url })); }
  catch { /* a report never holds the retry */ }
}
async function retryFromCard(error: ContentReadError, signal?: AbortSignal): Promise<void> {
  if (typeof document === 'undefined') throw error;
  const target = document, timeline = currentLoadingTimeline(), scope = new Scope('content-read-button');
  let group = retryGroups.get(target);
  if (group === undefined) {group = new Set(); retryGroups.set(target, group);}
  const pending = group;
  let id: number | undefined, resume: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) { reject(abortReason(signal)); return; }
      if (signal !== undefined) scope.listen(signal, 'abort', () => { reject(abortReason(signal)); }, { once: true });
      resume = resolve; pending.add(resolve);
      reportStall(target, error, timeline?.snapshot().current ?? null);
      id = beginLoadingWait(error.message, { kind: 'file', resource: error.url,
        owner: timeline?.waitOwner ?? null, step: timeline?.snapshot().current ?? null,
        retry: () => {for (const retry of pending) retry();}, retryNavigation: false, ...contentFailure(error) });
      shellRetry(scope, error, () => {for (const retry of pending) retry();});
    });
  } finally {
    if (id !== undefined) finishLoadingWait(id);
    if (resume !== undefined) pending.delete(resume);
    if (pending.size === 0) retryGroups.delete(target);
    scope.dispose();
  }
}

/** FM6 mode 34: the server's own wait, on the card as `packs-429` with its countdown; the read's signal cancels it. */
async function busyWait(error: ContentReadError, ms: number, signal?: AbortSignal): Promise<void> {
  const scope = new Scope('content-read-busy'), timeline = currentLoadingTimeline();
  const id = typeof document === 'undefined' ? undefined : beginLoadingWait(error.message, { kind: 'file', resource: error.url, owner: timeline?.waitOwner ?? null,
    step: timeline?.snapshot().current ?? null, ...contentFailure(error), dueAt: diagnosticNow() + ms });
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) { reject(abortReason(signal)); return; }
      if (signal !== undefined) scope.listen(signal, 'abort', () => { reject(abortReason(signal)); }, { once: true });
      scope.timeout(ms, resolve);
    });
  } finally { if (id !== undefined) finishLoadingWait(id); scope.dispose(); }
}

/** Read a complete bounded file. Retry one confirmed lost/missing transport immediately,
 * then leave the same load pending on RETRY. An optional first-party manifest
 * length shares this recovery; ordinary caps, parsing and hashes stay strict. */
export async function readContent(url: string, maximum: number, options: ContentReadOptions): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 25_000_000) throw new Error('Invalid content wire cap');
  if (options.expectedBytes !== undefined && (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes < 0 || options.expectedBytes > maximum)) throw new Error('Invalid expected content length');
  let retried = false;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      let response: Response;
      try { response = await options.fetch(url, { ...(retried ? { cache: 'reload' } : {}), ...(options.signal === undefined ? {} : { signal: options.signal }) }); }
      catch (error) { options.signal?.throwIfAborted(); throw new ContentReadError(url, 'connection unavailable', error); }
      return await body(response, url, maximum, options.read, options.expectedBytes, options.response);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof ContentReadError)) throw error;
      if (error.missing && options.missingThrows === true) throw error;
      // FM6 mode 34: a 429 that says when waits that long before the retry the budget already allows; the count is unchanged
      if (error.retryAfterMs !== null && error.retryAfterMs > 0) await busyWait(error, error.retryAfterMs, options.signal);
      if (!retried) { retried = true; }
      else {
        if (options.instead !== undefined && await options.instead(error)) throw error;
        // RL8 (Jake's phone, 2026-11-09: an old cached build sat at "0.00 MB of 28.4 MB"): a deploy keeps only the live
        // build's hashed files, so a missing first-party file on a build the server no longer serves can never arrive.
        // Instead of RETRY forever, the page reloads past its worker into the live build (once per build and tab).
        if (options.retry === undefined && error.missing && typeof document !== 'undefined'
          && await (await import('./browserChunkRecovery')).reloadIfStaleBuild()) await new Promise<void>(() => { /* never settles: the page is navigating */ });
        await (options.retry === undefined ? retryFromCard(error, options.signal) : options.retry(error)); retried = false;
      }
    }
  }
}
