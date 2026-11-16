import * as v from 'valibot';
import type { SocketControl } from './socketFrames';

/** Optional server observations; no player/account identifier or UI prose crosses this seam. */
export interface PersistenceWord {
  readonly code: 'save-confirmed' | 'save-failed';
  readonly sequence: number;
  readonly scope: string;
}
/** Other optional version-one status branches can be ignored independently. */
export interface PersistenceEnvelope { readonly v: 1; readonly persistence: PersistenceWord }
export const WORLD_STATUS_MAX_BYTES = 512;
const Fact = v.strictObject({ code: v.picklist(['save-confirmed', 'save-failed']),
  sequence: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  scope: v.pipe(v.string(), v.regex(/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u), v.maxLength(64)) });
const Status = v.object({ v: v.literal(1), persistence: Fact });
/** Bound the entire extension, not just its recognized branch. Unknown versions/codes are absent facts. */
export function persistenceEnvelope(value: unknown): PersistenceEnvelope | null {
  try {
    const text = JSON.stringify(value);
    if (text === undefined || new TextEncoder().encode(text).byteLength > WORLD_STATUS_MAX_BYTES) return null;
    const read = v.safeParse(Status, value);
    return read.success ? read.output : null;
  } catch { return null; }
}
/** An old server's initial discovery word simply has no persistence observation. Never interprets raw text as a cause. */
export function readPersistenceWord(bytes: ArrayBuffer): PersistenceWord | null {
  if (bytes.byteLength > 16_384) return null;
  try {
    const word: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof word !== 'object' || word === null || !('status' in word)) return null;
    return persistenceEnvelope(word.status)?.persistence ?? null;
  } catch { return null; }
}
/** Explicit client subscription; an old server, unknown extension or another control supplies no observation. */
export function subscribePersistence(listen: (listener: (control: SocketControl, bytes: ArrayBuffer) => void) => () => void,
  heard: (fact: PersistenceWord) => void): () => void {
  return listen((control, bytes) => {
    if (control !== 'world') return;
    const fact = readPersistenceWord(bytes);
    if (fact !== null) heard(fact);
  });
}
