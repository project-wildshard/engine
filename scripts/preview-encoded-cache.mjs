import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const br = promisify(brotliCompress), gz = promisify(gzip);
/** @param {string} file @param {'br'|'gzip'} encoding @param {number} size */
async function encodeFile(file, encoding, size) {
  const bytes = await readFile(file);
  return encoding === 'br' ? br(bytes, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 3, [constants.BROTLI_PARAM_SIZE_HINT]: size,
  } }) : gz(bytes);
}

/** @typedef {{identity:string,bytes:number|null,promise:Promise<Buffer>}} Entry */
/** Bounded representations of finished build files, including in-flight
 * coalescing. Metadata identity belongs to the server's actual stat lookup;
 * encodings never share entries or change the response's header policy.
 * @param {{maxBytes?:number,maxFileBytes?:number,encode?:(file:string,encoding:'br'|'gzip',size:number)=>Promise<Buffer>}} [options] */
export function createEncodedFileCache({ maxBytes = 64 * 1024 * 1024, maxFileBytes = 8 * 1024 * 1024, encode = encodeFile } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0) {
    throw new Error('Invalid encoded-cache limit');
  }
  /** @type {Map<string,Entry>} */ const entries = new Map();
  let storedBytes = 0, inFlightBytes = 0;
  /** @param {string} key @param {Entry} entry */
  const drop = (key, entry) => {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    if (entry.bytes !== null) storedBytes -= entry.bytes;
  };
  return {
    /** Undefined keeps the server's existing streaming path for oversized or
     * over-budget bodies. Failed encodes are never retained or retried here.
     * @param {string} file @param {string} identity @param {number} size @param {'br'|'gzip'} encoding
     * @returns {Promise<Buffer>|undefined} */
    get(file, identity, size, encoding) {
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid encoded file size');
      const key = `${file}\0${encoding}`, held = entries.get(key);
      if (held?.identity === identity) {
        entries.delete(key); entries.set(key, held); return held.promise;
      }
      if (held !== undefined) drop(key, held);
      if (size > maxFileBytes || size > maxBytes - inFlightBytes) return undefined;
      inFlightBytes += size;
      /** @type {Entry} */
      const entry = { identity, bytes: null, promise: Promise.resolve().then(async () => {
        try {
          const bytes = await encode(file, encoding, size);
          if (entries.get(key) !== entry) return bytes;
          if (bytes.length > maxBytes) { drop(key, entry); return bytes; }
          entry.bytes = bytes.length; storedBytes += bytes.length;
          for (const [oldKey, old] of entries) {
            if (storedBytes <= maxBytes) break;
            if (old.bytes !== null) drop(oldKey, old);
          }
          return bytes;
        } catch (error) { drop(key, entry); throw error; }
        finally { inFlightBytes -= size; }
      }) };
      entries.set(key, entry); return entry.promise;
    },
    snapshot: () => ({ storedBytes, inFlightBytes, entries: entries.size }),
  };
}
