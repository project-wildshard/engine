// oxlint-disable-next-line import/no-nodejs-modules -- A room keeps the pack parts it has read on its own disk (E7.3).
import { createHash, randomUUID } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- A room keeps the pack parts it has read on its own disk (E7.3).
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- A room keeps the pack parts it has read on its own disk (E7.3).
import { join } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- `fetch` undoes `br` only where the origin says it is `br`, and a stored `.pack.br` may not.
import { brotliDecompressSync } from 'node:zlib';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import { readServerProduct, type ServerRead } from '../standalone/serverProduct';

/** What a reader counts, so a boot can say where its bytes came from. */
export interface PackReads { fetched: number; fetchedBytes: number; cached: number; refused: number }
/** How a room's reader is built. */
export interface PackReaderOptions {
  /** Where the book and its parts are: `https://…`, or a `file:` folder laid out the same. */
  readonly origin: string;
  /** Where parts are kept, one folder per part's SHA-256. */
  readonly cache: string;
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const originBytes = async (url: URL, path: string, origin: string): Promise<Uint8Array> => {
  // A book's paths start at its origin, and a `file:` URL's root is the disk's.
  if (url.protocol === 'file:') return new Uint8Array(await readFile(new URL(path.replace(/^\//u, ''), origin.endsWith('/') ? origin : `${origin}/`)));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing server input ${path}`);
  return new Uint8Array(await response.arrayBuffer());
};
/** What is left of a part once `br` is undone, if `br` is still on it. */
function undone(bytes: Uint8Array, hash: string): Uint8Array {
  if (sha256(bytes) === hash) return bytes;
  try { const open = new Uint8Array(brotliDecompressSync(bytes)); return sha256(open) === hash ? open : bytes; } catch { return bytes; }
}

/** E7.3: `ServerRead` for a Node room: the book from the origin each boot, and each part from `cache` if it still hashes true. No `location`, no `caches`. */
export function packRead(options: PackReaderOptions, reads: PackReads): ServerRead {
  return async (url, path, hash) => {
    if (hash === undefined) return originBytes(url, path, options.origin);
    const folder = join(options.cache, hash), file = join(folder, 'body');
    const kept = await readFile(file).catch(() => null);
    if (kept !== null) {
      if (sha256(kept) === hash) { reads.cached++; return new Uint8Array(kept); }
      reads.refused++; // a cached byte went bad: this copy is refused, and the network's stands in
      await rm(file, { force: true });
    }
    const body = undone(await originBytes(url, path, options.origin), hash);
    if (sha256(body) !== hash) throw new Error(`Server input hash mismatch: ${path}`);
    reads.fetched++; reads.fetchedBytes += body.byteLength;
    await mkdir(folder, { recursive: true });
    const parked = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(parked, body, { flag: 'wx' }); await rename(parked, file); }
    finally { await rm(parked, { force: true }); }
    return body;
  };
}
/** One shard's server inputs, through its build's book. */
export function readPackProduct(slug: string, build: string, rapier: Rapier, options: PackReaderOptions, reads: PackReads): Promise<HeadlessRuntimeInput> {
  return readServerProduct(new URL(`shards/${slug}/`, options.origin.endsWith('/') ? options.origin : `${options.origin}/`).href, () => build, packRead(options, reads), rapier);
}
