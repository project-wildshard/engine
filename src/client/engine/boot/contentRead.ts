import { Scope } from '../../../shared/engine/app/scope';
import { beginLoadingWait, finishLoadingWait } from '../../../shared/engine/boot/loadingWaits';
import { currentLoadingTimeline } from '../../../shared/engine/boot/timeline';

/** A missing or interrupted transport, never a parsed-content or admission refusal. */
export class ContentReadError extends Error {
  readonly url: string;
  constructor(url: string, detail: string, cause?: unknown) {
    super(`Read failed: ${new URL(url, 'https://content.invalid').pathname} · ${detail}`, { cause });
    this.name = 'ContentReadError'; this.url = url;
  }
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
}

function html(bytes: Uint8Array): boolean {
  return /^\s*<(?:!doctype\s+html\b|html(?:\s|>))/iu.test(new TextDecoder().decode(bytes.subarray(0, 128)));
}
async function body(response: Response, url: string, maximum: number, read?: (bytes: number) => void, expected?: number,
  received?: (response: Response) => void): Promise<Uint8Array<ArrayBuffer>> {
  const sizeError = (): Error => expected === undefined ? new Error('Content wire size exceeds cap')
    : new ContentReadError(url, 'byte length differs from manifest');
  if (!response.ok || /\btext\/html\b/iu.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => undefined);
    throw new ContentReadError(url, response.ok ? 'missing content (HTML response)' : `HTTP ${response.status}`);
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
      bytes.set(part.value, size); size = next; read?.(part.value.byteLength);
    }
  } catch (error) {
    // A caller may own a clone. Cancelling a tee waits for both branches;
    // do not deadlock recovery before the caller can retire its failed clone.
    void reader.cancel().catch(() => undefined); throw error;
  }
  const result = size === bytes.length ? bytes : bytes.slice(0, size);
  if (html(result)) throw new ContentReadError(url, 'missing content (HTML response)');
  if (expected !== undefined && size !== expected) throw sizeError();
  return result;
}

function abortReason(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('Content read cancelled', 'AbortError');
}
const retryGroups = new WeakMap<Document, Set<() => void>>();
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
      id = beginLoadingWait(error.message, { kind: 'file', resource: error.url,
        owner: timeline?.waitOwner ?? null, step: timeline?.snapshot().current ?? null,
        retry: () => {for (const retry of pending) retry();}, retryNavigation: false });
    });
  } finally {
    if (id !== undefined) finishLoadingWait(id);
    if (resume !== undefined) pending.delete(resume);
    if (pending.size === 0) retryGroups.delete(target);
    scope.dispose();
  }
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
      if (!retried) { retried = true; }
      else { await (options.retry === undefined ? retryFromCard(error, options.signal) : options.retry(error)); retried = false; }
    }
  }
}
