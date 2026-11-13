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

/** The file's text as what it says. It throws on a bad signature, and where a browser has no Ed25519. `publicKey` is SPKI DER in hex. */
export async function readSignedRelease(text: string, publicKey: string): Promise<ReleaseFile> {
  const signed = v.parse(SignedSchema, JSON.parse(text)), key = await importKey(publicKey);
  if (!await crypto.subtle.verify({ name: 'Ed25519' }, key, hexBytes(signed.signature), new TextEncoder().encode(signed.body))) throw new Error('A release file has a bad signature');
  return v.parse(ReleaseSchema, JSON.parse(signed.body));
}
/** FM5 (catalogue mode 11): a release read that has not answered, body and all, in 8 s has failed. */
export const RELEASE_DEADLINE_MS = 8000;
/** OFFLINE OF4: how long a verified release file is kept for a page that can't read a fresh one (the recommended limit; reversible). */
export const KEPT_RELEASE_MS: number = 7 * 24 * 60 * 60 * 1000;

/** The release file at `url`, never from a cache: a stale one would dial an old address. It throws past `deadlineMs`. */
export async function fetchSignedRelease(url: string, publicKey: string, deadlineMs: number = RELEASE_DEADLINE_MS, read: typeof fetch = fetch): Promise<ReleaseFile> {
  return readSignedRelease(await fetchReleaseText(url, deadlineMs, read), publicKey);
}
async function fetchReleaseText(url: string, deadlineMs: number, read: typeof fetch): Promise<string> {
  const abort = new AbortController(), scope = new Scope('online.release-read');
  scope.timeout(deadlineMs, () => { abort.abort(); });
  try {
    const response = await read(url, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error(`No release file at ${url}: ${String(response.status)}`);
    return await response.text();
  } catch (error) {
    if (abort.signal.aborted) throw new Error(`No release file at ${url} in ${String(deadlineMs)} ms`, { cause: error });
    throw error;
  } finally { scope.dispose(); }
}

/** OF4: the last release file a page read and believed: which release, when, and its text as signed. */
export interface KeptRelease { readonly of: string; readonly at: number; readonly text: string }
export interface ReleaseKeep { readonly read: () => KeptRelease | null; readonly write: (kept: KeptRelease) => void }

/** The kept copy, only if it is this release's, no older than 7 days and its signature holds again now. Anything else is no copy. */
export async function keptRelease(url: string, publicKey: string, keep: ReleaseKeep, now: number = Date.now()): Promise<ReleaseFile | null> {
  try {
    const kept = keep.read(), age = kept === null ? -1 : now - kept.at;
    if (kept?.of !== url || age < 0 || age > KEPT_RELEASE_MS) return null;
    return await readSignedRelease(kept.text, publicKey);
  } catch { return null; }
}

/** What a page dials from: the file, and when that was the kept copy, the fresh read still under way (null if it fails). */
export interface ReleaseToDial { readonly file: ReleaseFile; readonly fresh: Promise<ReleaseFile | null> | null }
/** OF4: the release file a page dials from. A verified kept copy answers at once, so a load never waits on the read; the fresh read
 *  replaces it once its own signature holds. With no copy the page waits for the read (8 s at most), and a failed read throws. */
export async function releaseToDial(url: string, publicKey: string, ports: { readonly keep: ReleaseKeep; readonly fetch?: typeof fetch; readonly now?: () => number; readonly deadlineMs?: number }): Promise<ReleaseToDial> {
  const now = ports.now ?? Date.now, kept = await keptRelease(url, publicKey, ports.keep, now());
  const reading = (async (): Promise<ReleaseFile> => {
    const text = await fetchReleaseText(url, ports.deadlineMs ?? RELEASE_DEADLINE_MS, ports.fetch ?? fetch), file = await readSignedRelease(text, publicKey);
    // a release only moves forward (J179, the server's own rule in releaseFile.ts): an older signed file never replaces the kept one
    if (kept !== null && file.serial < kept.serial) throw new Error(`A release file older than the kept one (${String(file.serial)} < ${String(kept.serial)})`);
    try { ports.keep.write({ of: url, at: now(), text }); } catch { /* a page that can keep nothing reads again next time */ }
    return file;
  })();
  if (kept === null) return { file: await reading, fresh: null };
  return { file: kept, fresh: reading.catch(() => null) };
}
