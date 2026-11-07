import {zlibSync} from 'fflate';

/** The bake's portable deflate, on bounded unshared bytes: the same stream as sharddev's `bake/portableBytes.ts`. */
export function encodePortableBytes(input: Uint8Array, level: 0|1|2|3|4|5|6|7|8|9 = 9): Uint8Array<ArrayBuffer> {
  if (!(input instanceof Uint8Array) || !(input.buffer instanceof ArrayBuffer) || input.byteLength > 256_000_000) throw new Error('Build codec requires bounded unshared bytes');
  return new Uint8Array(zlibSync(new Uint8Array(input), {level}));
}
