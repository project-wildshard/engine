/** Standalone shardfiles SF21: the cook's texture encodes kept across jobs. A cook job used to keep no encodes, so a killed
 * or repeated cook of a big zone encoded every texture again (Pine's images-only cook: about 1500 s of textures phase on
 * every try). The two encoders (`imageKtx2Wasm.ts` for the desktop tier, `astc6Wasm.ts` for the phone's 6x6) keep each
 * output in a cache folder, named by a key over everything that output depends on:
 *
 *   the encoder and its revision (which names its tier), basisu's build, the encode settings, the texel read (role) and
 *   flip, and the input bytes.
 *
 * So a changed setting, a new basisu build or an encoder change (its revision is bumped) is a new key and never serves a
 * stale file. The key is not the cook version's (QA 11-26 row 31): the cook version moves on every cook change (1.11 to
 * 1.14 in a few hours), and naming it emptied every cache on each bump, so CI's memory build encoded all 27 pins from
 * cold and ran out of its 30 minutes. The keys are byte for byte the ones from before SF21, so caches made then still
 * hit (`test/cook-encode-cache.test.ts` fixes one). A hit is used
 * only when it is a whole KTX2 (its identifier, and every level inside the file); anything else is encoded again and
 * replaced. A cook job's folder is `COOK_ENCODE_CACHE`, which `cookWorker.ts` sets to the job's surviving cache folder. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, readFileSync, utimesSync} from 'node:fs';
import {isKtx2} from './tierTextures.ts';

const LEVEL_INDEX = 80, LEVEL_ENTRY = 24;

/** The cache folder an encoder uses: the one it was given, else the cook job's (`COOK_ENCODE_CACHE`), else none. */
export function encodeCacheDir(given: string | undefined): string | undefined {
  const fromJob = process.env['COOK_ENCODE_CACHE'];
  return given ?? (fromJob === undefined || fromJob === '' ? undefined : fromJob);
}

/** The cache key of one encode: every setting part, each followed by `|`, then the input bytes. */
export function encodeKey(parts: readonly string[], input: Uint8Array): string {
  return createHash('sha256').update(`${parts.join('|')}|`).update(input).digest('hex');
}

/** True when `bytes` is a whole KTX2: its identifier, and every level's bytes inside the file. */
export function wholeKtx2(bytes: Uint8Array): boolean {
  if (!isKtx2(bytes)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), levels = Math.max(1, view.getUint32(40, true));
  if (LEVEL_INDEX + LEVEL_ENTRY * levels > bytes.length) return false;
  for (let level = 0; level < levels; level++) {
    const entry = LEVEL_INDEX + LEVEL_ENTRY * level;
    const at = view.getBigUint64(entry, true), length = view.getBigUint64(entry + 8, true);
    if (length === 0n || at < BigInt(LEVEL_INDEX) || at + length > BigInt(bytes.length)) return false;
  }
  return true;
}

/** A kept encode, or undefined when there is none or it is not a whole KTX2. A hit marks the file in use, so a cache
 *  pruned by age keeps what cooks still read. */
export function readKeptKtx2(path: string): Uint8Array | undefined {
  if (!existsSync(path)) return undefined;
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(readFileSync(path)); } catch { return undefined; }
  if (!wholeKtx2(bytes)) return undefined;
  try { const now = new Date(); utimesSync(path, now, now); } catch { /* A read-only cache still serves. */ }
  return bytes;
}
