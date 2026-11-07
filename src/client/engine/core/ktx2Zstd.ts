/**
 * G639 frame floor: a KTX2 whose levels are raw texels (a GPU or plain format, not Basis) zstd-supercompressed
 * (scheme 2: the SDK's byte-exact RGBA8 / R8 bakes, sharddev/bake/texture.ts) is decoded by three's KTX2Loader on the page's
 * thread (`createRawTexture` → zstddec, ~100 ms of one Nalati drive frame at phone 4x). `unsupercompressKtx2` decodes its
 * levels in one page-owned worker first and hands three the same file with those levels stored plain (scheme 0), so its
 * parse only copies them. Anything else (Basis, no supercompression, a failed worker) passes through unchanged: three then
 * decodes it as before.
 */
import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';

const HEADER = 80, LEVEL = 24, SCHEME_ZSTD = 2;
/** level data starts at a multiple of this in the rewritten file (the spec's lcm(texel block size, 4) for every format) */
const ALIGN = 16;
interface Pending { scope: Scope; resolve: (levels: Uint8Array[]) => void; reject: (error: Error) => void }
let worker: Worker | null = null, scope: Scope | null = null, idle: Scope | null = null;
let failed = false, sequence = 0;
const pending = new Map<number, Pending>();

function stop(reason: Error, permanent: boolean): void {
  const active = worker, owner = scope;
  worker = null; scope = null; idle = null; failed ||= permanent;
  const requests = [...pending.values()]; pending.clear();
  for (const request of requests) { request.scope.dispose(); request.reject(reason); }
  active?.terminate(); owner?.dispose();
}
function receive(event: MessageEvent<unknown>): void {
  const reply = event.data;
  if (typeof reply !== 'object' || reply === null) { stop(new Error('Invalid zstd decode reply'), true); return; }
  const id: unknown = Reflect.get(reply, 'id'), levels: unknown = Reflect.get(reply, 'levels');
  if (typeof id !== 'number') { stop(new Error('Invalid zstd decode identity'), true); return; }
  const request = pending.get(id);
  if (request === undefined) return;
  pending.delete(id); request.scope.dispose();
  const decoded = Array.isArray(levels) ? levels.filter((level): level is Uint8Array => level instanceof Uint8Array) : [];
  if (Array.isArray(levels) && decoded.length === levels.length) request.resolve(decoded);
  else {
    const message: unknown = Reflect.get(reply, 'error');
    request.reject(new Error(typeof message === 'string' ? message : 'zstd decode failed'));
  }
  armIdle();
}
/** With nothing pending the worker stops after 30 s */
function armIdle(): void {
  if (pending.size > 0 || scope === null) return;
  idle?.dispose(); const owner = scope.child('idle'); idle = owner;
  owner.timeout(30_000, () => { if (pending.size === 0) stop(new Error('zstd decoder idle'), false); });
}
function start(): Worker {
  if (worker !== null) return worker;
  const owner = pageScope.child('ktx2-zstd');
  try {
    const made = new Worker(new URL('ktx2Zstd.worker.ts', import.meta.url), { type: 'module', name: 'ktx2-zstd' });
    worker = made; scope = owner;
    owner.listen(made, 'message', receive);
    owner.listen(made, 'error', event => { event.preventDefault(); stop(new Error('zstd decode worker failed'), true); });
    owner.listen(made, 'messageerror', () => { stop(new Error('zstd decode transfer failed'), true); });
    owner.onDispose(() => { if (scope === owner) stop(new Error('zstd decoder disposed'), false); });
    return made;
  } catch (error) { owner.dispose(); failed = true; throw error; }
}
/** Start the decoder now when any of `files` needs it (a raw-texel zstd KTX2), so a caller about to transcode them spins
 *  it up from its own stack before its first parse (DL17: a grid neighbour's lazily made decoder showed only a material
 *  loop's resumed frames, no caller, and its script fetch after control read as the home level's). Unused, it idles out
 *  as after a decode. */
export function prepareKtx2Zstd(files: Iterable<Uint8Array | undefined>): void {
  if (failed || worker !== null || typeof Worker !== 'function') return;
  for (const bytes of files) {
    if (bytes === undefined || zstdLevels(bytes) === null) continue;
    try { start(); } catch { return; } // the first parse falls back to three's own decode, as before
    armIdle(); return;
  }
}
function decodeLevels(levels: { data: Uint8Array; size: number }[]): Promise<Uint8Array[]> {
  const decoder = start(), owner = scope;
  if (owner === null) return Promise.reject(new Error('zstd decoder missing'));
  idle?.dispose(); idle = null;
  return new Promise<Uint8Array[]>((resolve, reject) => {
    const id = ++sequence, request = owner.child('decode');
    pending.set(id, { scope: request, resolve, reject });
    try { decoder.postMessage({ id, levels }, { transfer: levels.map(level => level.data.buffer) }); }
    catch (error) { stop(error instanceof Error ? error : new Error(String(error)), true); }
  });
}

/** One admitted byte block borrows the same serialized worker as texture levels.
 * Own the transferred input; the caller's verified body remains attached. */
export async function decodeZstdBlock(bytes: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > 64 * 1024 * 1024
    || bytes.length > 64 * 1024 * 1024) throw new Error('Zstd byte block exceeds limit');
  if (failed) throw new Error('Zstd decode worker unavailable');
  const decoded = await decodeLevels([{ data: bytes.slice(), size: expectedBytes }]);
  const result = decoded[0];
  if (decoded.length !== 1 || result === undefined || result.byteLength !== expectedBytes) throw new Error('Zstd output byte count differs');
  return result;
}

/** A level's place in the file (KTX2 level index: byteOffset, byteLength, uncompressedByteLength, each a u64). */
interface Level { offset: number; length: number; size: number }
/** The levels of a raw-texel zstd KTX2 (vkFormat set, scheme 2, no global data), or null for any other file. */
export function zstdLevels(bytes: Uint8Array): Level[] | null {
  if (bytes.byteLength < HEADER || bytes[0] !== 0xab || bytes[1] !== 0x4b || bytes[2] !== 0x54 || bytes[3] !== 0x58) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vkFormat = view.getUint32(12, true), levelCount = Math.max(1, view.getUint32(40, true)), scheme = view.getUint32(44, true);
  if (vkFormat === 0 || scheme !== SCHEME_ZSTD || view.getBigUint64(72, true) !== 0n) return null;
  if (HEADER + levelCount * LEVEL > bytes.byteLength) return null;
  const levels: Level[] = [];
  for (let i = 0; i < levelCount; i++) {
    const at = HEADER + i * LEVEL;
    const offset = Number(view.getBigUint64(at, true)), length = Number(view.getBigUint64(at + 8, true)), size = Number(view.getBigUint64(at + 16, true));
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || !Number.isSafeInteger(size) || offset + length > bytes.byteLength) return null;
    levels.push({ offset, length, size });
  }
  return levels;
}
/** The same file with `decoded` stored plain in place of its supercompressed levels (scheme 0, new level index). */
export function plainKtx2(bytes: Uint8Array, levels: readonly Level[], decoded: readonly Uint8Array[]): Uint8Array {
  // everything before the first level's data (header, index, descriptor, key / values) is kept byte for byte
  const head = Math.min(...levels.map(level => level.offset));
  const offsets: number[] = [];
  let end = head;
  // three reads each level at its own offset: the original order of the data is kept (smallest mip first)
  const order = levels.map((level, i) => ({ level, i })).sort((a, b) => a.level.offset - b.level.offset);
  const placed = new Map<number, number>();
  for (const { i } of order) { end = Math.ceil(end / ALIGN) * ALIGN; placed.set(i, end); end += decoded[i]?.byteLength ?? 0; }
  for (let i = 0; i < levels.length; i++) offsets.push(placed.get(i) ?? 0);
  const out = new Uint8Array(end);
  out.set(bytes.subarray(0, head));
  const view = new DataView(out.buffer);
  view.setUint32(44, 0, true);
  for (let i = 0; i < levels.length; i++) {
    const data = decoded[i], at = HEADER + i * LEVEL, offset = offsets[i] ?? 0;
    if (data === undefined) throw new Error('Missing decoded KTX2 level');
    out.set(data, offset);
    view.setBigUint64(at, BigInt(offset), true); view.setBigUint64(at + 8, BigInt(data.byteLength), true); view.setBigUint64(at + 16, BigInt(data.byteLength), true);
  }
  return out;
}

/** A raw-texel zstd KTX2's bytes with its levels decoded off the page's thread; any other file (or a failure): `buffer`. */
export async function unsupercompressKtx2(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (failed || typeof Worker !== 'function') return buffer;
  const bytes = new Uint8Array(buffer), levels = zstdLevels(bytes);
  if (levels === null) return buffer;
  try {
    const decoded = await decodeLevels(levels.map(level => ({ data: bytes.slice(level.offset, level.offset + level.length), size: level.size })));
    if (decoded.length !== levels.length || decoded.some((data, i) => data.byteLength !== levels[i]?.size)) return buffer;
    const plain = plainKtx2(bytes, levels, decoded);
    return plain.buffer instanceof ArrayBuffer ? plain.buffer : buffer;
  } catch { return buffer; }
}
