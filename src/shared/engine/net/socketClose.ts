// FM7b1: optional close-frame facts; codes and binary game frames remain unchanged.
import * as v from 'valibot';

/** Terminal/queue facts only. Wording lives in the client; an absent number is unknown. */
export type SocketCloseInfo =
  | { readonly code: 'queue'; readonly position?: number; readonly etaMs?: number }
  | { readonly code: 'banned'; readonly untilMs?: number }
  | { readonly code: 'auth-expired' | 'refused' };
/** RFC6455 leaves 123 UTF-8 bytes after the two-byte close code. */
export const SOCKET_CLOSE_REASON_BYTES = 123;
const Whole = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const Schema: v.GenericSchema<SocketCloseInfo & { readonly v: 1 }> = v.variant('code', [
  v.strictObject({ v: v.literal(1), code: v.literal('queue'), position: v.exactOptional(v.pipe(Whole, v.minValue(1), v.maxValue(1_000_000))), etaMs: v.exactOptional(v.pipe(Whole, v.maxValue(604_800_000))) }),
  // a Date can hold at most 8.64e15 ms: a later end time is malformed, never a card that throws while it renders
  v.strictObject({ v: v.literal(1), code: v.literal('banned'), untilMs: v.exactOptional(v.pipe(Whole, v.maxValue(8.64e15))) }),
  v.strictObject({ v: v.literal(1), code: v.picklist(['auth-expired', 'refused']) }),
]);
const matches = (reason: string, info: SocketCloseInfo): boolean => reason === 'full' ? info.code === 'queue' : reason === 'refused' && info.code !== 'queue';
/** Fail closed to the existing generic close reason; never stop a close because optional metadata is bad. */
export function encodeSocketCloseInfo(reason: string, info?: SocketCloseInfo): string {
  if (info === undefined) return '';
  const value = v.safeParse(Schema, { ...info, v: 1 });
  if (!value.success || !matches(reason, value.output)) return '';
  const text = JSON.stringify(value.output);
  return new TextEncoder().encode(text).byteLength <= SOCKET_CLOSE_REASON_BYTES ? text : '';
}
/** Unknown versions/codes, malformed input and reasons inappropriate for the close code are all legacy generic ends. */
export function decodeSocketCloseInfo(reason: string, text: string): SocketCloseInfo | null {
  if (text.length > SOCKET_CLOSE_REASON_BYTES || new TextEncoder().encode(text).byteLength > SOCKET_CLOSE_REASON_BYTES) return null;
  try {
    const value = v.safeParse(Schema, JSON.parse(text));
    if (!value.success || !matches(reason, value.output)) return null;
    const { v: _version, ...info } = value.output;
    return info;
  } catch { return null; }
}
