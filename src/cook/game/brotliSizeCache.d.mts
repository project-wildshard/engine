/** Pure build-side compression memo; no product admission authority. */
export class BrotliSizeCache {
  constructor(directory:string,representation?:'served'|'precompressed');
  bytes(bytes:Uint8Array):number;
}
