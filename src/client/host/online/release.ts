// E7.2d: a page's read of the signed release file (J171): the build the world runs and the address to dial. WebCrypto's Ed25519, so no
// signature code ships in the client. A page believes nothing in the file before its signature holds.
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { ReleaseSchema, SignedSchema, type ReleaseFile } from '../../../shared/host/releaseRows';

const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => Uint8Array.from(hex.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));

/** A browser with no Ed25519 can't read the file, so a player is told what to do. Chrome 133 and 134 on Android stop here (E7.9). */
const importKey = async (publicKey: string): Promise<CryptoKey> => {
  try { return await crypto.subtle.importKey('spki', hexBytes(publicKey), { name: 'Ed25519' }, false, ['verify']); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotSupportedError') throw new Error('This browser is too old for the online world. Update it to Chrome 137 or Safari 17, or newer.', { cause: error });
    throw error;
  }
};

/** FM5: why a release read failed, as the page can measure it. A browser never says DNS or TLS, so `network` is all an opaque fetch
 *  failure is; `offline` is one the browser itself calls offline; `portal` is an answer that isn't the file (HTML, an unapproved redirect,
 *  malformed text), which could be a captive portal or a broken origin. */
export type ReleaseFault =
  | { readonly kind: 'offline' } | { readonly kind: 'network' } | { readonly kind: 'timeout'; readonly ms: number }
  | { readonly kind: 'status'; readonly status: number; readonly retryAfterMs: number | null }
  | { readonly kind: 'portal'; readonly why: 'html' | 'redirect' | 'malformed' } | { readonly kind: 'unsigned' };
/** A failed release read and what failed. Its message keeps the technical words for Details; a player's screen never shows it raw. */
export class ReleaseReadError extends Error {
  readonly fault: ReleaseFault;
  constructor(message: string, fault: ReleaseFault, cause?: unknown) { super(message, cause === undefined ? undefined : { cause }); this.name = 'ReleaseReadError'; this.fault = fault; }
}

/** The file's text as what it says. It throws on a bad signature, and where a browser has no Ed25519. `publicKey` is SPKI DER in hex. */
export async function readSignedRelease(text: string, publicKey: string): Promise<ReleaseFile> {
  let signed: v.InferOutput<typeof SignedSchema>;
  try { signed = v.parse(SignedSchema, JSON.parse(text)); } catch (error) { throw new ReleaseReadError('A release file that is not a signed file', { kind: 'portal', why: 'malformed' }, error); }
  const key = await importKey(publicKey);
  if (!await crypto.subtle.verify({ name: 'Ed25519' }, key, hexBytes(signed.signature), new TextEncoder().encode(signed.body))) throw new ReleaseReadError('A release file has a bad signature', { kind: 'unsigned' });
  try { return v.parse(ReleaseSchema, JSON.parse(signed.body)); } catch (error) { throw new ReleaseReadError('A signed release file this page cannot read', { kind: 'portal', why: 'malformed' }, error); }
}
/** FM5 mode 12: a `Retry-After` of seconds or an HTTP date, in ms from `now`; anything else (or past 10 min) is no answer. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const text = header.trim(), ms = /^\d{1,6}$/u.test(text) ? Number(text) * 1000 : /[a-z]/iu.test(text) ? Date.parse(text) - now : Number.NaN;
  return Number.isFinite(ms) && ms >= 0 && ms <= 600_000 ? Math.round(ms) : null;
}
/** FM5 (catalogue mode 11): a release read that has not answered, body and all, in 8 s has failed. */
export const RELEASE_DEADLINE_MS = 8000;
/** OFFLINE OF4: how long a verified release file is kept for a page that can't read a fresh one (the recommended limit; reversible). */
export const KEPT_RELEASE_MS: number = 7 * 24 * 60 * 60 * 1000;

/** The release file at `url`, never from a cache: a stale one would dial an old address. It throws past `deadlineMs`. */
export async function fetchSignedRelease(url: string, publicKey: string, deadlineMs: number = RELEASE_DEADLINE_MS, read: typeof fetch = fetch): Promise<ReleaseFile> {
  return (await verifiedRead(url, publicKey, deadlineMs, read)).file;
}
const browserOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;
/** SB29: requesting abort does not settle a producer's promise. Bound the entire read, including body and WebCrypto. */
async function releaseDeadline<T>(url: string, deadlineMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController(), scope = new Scope('online.release-read');
  const expired = new Promise<never>((_resolve, reject) => {
    scope.timeout(deadlineMs, () => {
      reject(new ReleaseReadError(`No release file at ${url} in ${String(deadlineMs)} ms`, { kind: 'timeout', ms: deadlineMs }));
      abort.abort();
    });
  });
  try { return await Promise.race([work(abort.signal), expired]); }
  finally { scope.dispose(); }
}
function verifiedRead(url: string, publicKey: string, deadlineMs: number, read: typeof fetch, online: () => boolean = browserOnline): Promise<{ text: string; file: ReleaseFile }> {
  return releaseDeadline(url, deadlineMs, async signal => {
    const text = await fetchReleaseText(url, signal, read, online);
    signal.throwIfAborted();
    const file = await readSignedRelease(text, publicKey);
    return { text, file };
  });
}
async function fetchReleaseText(url: string, signal: AbortSignal, read: typeof fetch, online: () => boolean): Promise<string> {
  try {
    const response = await read(url, { cache: 'no-store', signal });
    if (!response.ok) throw new ReleaseReadError(`No release file at ${url}: ${String(response.status)}`, { kind: 'status', status: response.status, retryAfterMs: retryAfterMs(response.headers.get('retry-after')) });
    // FM5 mode 38: an answer from somewhere else, or a page instead of the file, isn't the world's file; nothing in it is followed
    if (response.redirected && response.url !== '' && new URL(response.url).origin !== new URL(url).origin) throw new ReleaseReadError(`The release read was sent to another address (${String(response.status)})`, { kind: 'portal', why: 'redirect' });
    const text = await response.text();
    if (/html/iu.test(response.headers.get('content-type') ?? '') || /^\s*</u.test(text)) throw new ReleaseReadError(`A page instead of the release file (${response.headers.get('content-type') ?? 'no type'})`, { kind: 'portal', why: 'html' });
    return text;
  } catch (error) {
    if (error instanceof ReleaseReadError) throw error;
    throw new ReleaseReadError(error instanceof Error ? error.message : String(error), online() ? { kind: 'network' } : { kind: 'offline' }, error);
  }
}
/** OF4: the last release file a page read and believed: which release, when, and its text as signed. */
export interface KeptRelease { readonly of: string; readonly at: number; readonly text: string }
export interface ReleaseKeep { readonly read: () => KeptRelease | null; readonly write: (kept: KeptRelease) => void }

/** The kept copy, only if it is this release's, no older than 7 days and its signature holds again now. Anything else is no copy. */
export async function keptRelease(url: string, publicKey: string, keep: ReleaseKeep, now: number = Date.now(), deadlineMs: number = RELEASE_DEADLINE_MS): Promise<ReleaseFile | null> {
  try {
    const kept = keep.read(), age = kept === null ? -1 : now - kept.at;
    if (kept?.of !== url || age < 0 || age > KEPT_RELEASE_MS) return null;
    return await releaseDeadline(url, deadlineMs, () => readSignedRelease(kept.text, publicKey));
  } catch { return null; }
}

/** What a page dials from: the file, and when that was the kept copy, the fresh read still under way (null if it fails). */
export interface ReleaseToDial { readonly file: ReleaseFile; readonly fresh: Promise<ReleaseFile | null> | null }

/** FM5: the screen a failed read with no kept copy shows (meta MMO-FAILURE-MODES-PLAN modes 1, 11, 12, 37 to 39). */
export type ReleaseScreen = 'offline-launch' | 'release-5xx' | 'release-429' | 'release-404' | 'captive-portal' | 'release-unsigned';
export function releaseScreen(fault: ReleaseFault): ReleaseScreen {
  if (fault.kind === 'offline') return 'offline-launch';
  if (fault.kind === 'portal') return 'captive-portal';
  if (fault.kind === 'unsigned') return 'release-unsigned';
  if (fault.kind === 'status' && fault.status === 429) return 'release-429';
  if (fault.kind === 'status' && fault.status === 404) return 'release-404';
  return 'release-5xx';
}
/** Mode 11's ladder: 2, 4, 8, 16 s, then every 30 s. */
const LADDER_MS: readonly number[] = [2000, 4000, 8000, 16_000], LADDER_END_MS = 30_000;
/** Mode 12: a 429 with no readable Retry-After waits this long first. Mode 37: a 404 is read again each minute. */
const BUSY_MS = 20_000, MISSING_MS = 60_000;
/** FM5's retry policy: how long after the `attempt`th failed read (from 0) the page reads again by itself, or null when only the player
 *  (Try again), the network coming back or the page coming into view reads again: offline, a captive portal, a file that fails its
 *  signature (no retry loop on a file we can't verify). */
export function releaseRetryMs(fault: ReleaseFault, attempt: number): number | null {
  const ladder = LADDER_MS[attempt] ?? LADDER_END_MS;
  if (fault.kind === 'offline' || fault.kind === 'portal' || fault.kind === 'unsigned') return null;
  if (fault.kind !== 'status') return ladder;
  // a Retry-After of 0 is no licence to loop: never sooner than the ladder's first step, and never sooner than the first refusal's wait
  if (fault.status === 429) return Math.max(fault.retryAfterMs ?? BUSY_MS, LADDER_MS[0] ?? 2000, fault.retryAfterMs === null ? ladder : 0);
  return fault.status === 404 ? MISSING_MS : ladder;
}
/** FM5: what a page shows while it has no release file to dial from. `after` shows the fault and settles when the page should read again
 *  (the policy's wait, Try again, the network back); it rejects when the player leaves. `done` closes whatever it showed. */
export interface ReleaseWait {
  readonly after: (fault: ReleaseFault, attempt: number, retryMs: number | null, detail: string) => Promise<void>;
  readonly done: () => void;
}

/** OF4: the release file a page dials from. A verified kept copy answers at once, so a load never waits on the read; the fresh read
 *  replaces it once its own signature holds. With no copy the page waits for the read (8 s at most each), and a failed read throws, or,
 *  given `wait` (FM5), shows why and reads again by its policy until a verified file answers or the player leaves. */
export async function releaseToDial(url: string, publicKey: string, ports: { readonly keep: ReleaseKeep; readonly fetch?: typeof fetch; readonly now?: () => number; readonly deadlineMs?: number; readonly wait?: ReleaseWait; readonly online?: () => boolean }): Promise<ReleaseToDial> {
  const now = ports.now ?? Date.now, kept = await keptRelease(url, publicKey, ports.keep, now(), ports.deadlineMs);
  const reading = async (): Promise<ReleaseFile> => {
    const { text, file } = await verifiedRead(url, publicKey, ports.deadlineMs ?? RELEASE_DEADLINE_MS, ports.fetch ?? fetch, ports.online);
    // a release only moves forward (J179, the server's own rule in releaseFile.ts): an older signed file never replaces the kept one
    if (kept !== null && file.serial < kept.serial) throw new Error(`A release file older than the kept one (${String(file.serial)} < ${String(kept.serial)})`);
    try { ports.keep.write({ of: url, at: now(), text }); } catch { /* a page that can keep nothing reads again next time */ }
    return file;
  };
  if (kept !== null) return { file: kept, fresh: reading().catch(() => null) };
  const { wait } = ports;
  if (wait === undefined) return { file: await reading(), fresh: null };
  for (let attempt = 0; ; attempt++) {
    try {
      const file = await reading();
      wait.done();
      return { file, fresh: null };
    } catch (error) {
      if (!(error instanceof ReleaseReadError)) { wait.done(); throw error; }
      await wait.after(error.fault, attempt, releaseRetryMs(error.fault, attempt), error.message);
    }
  }
}
