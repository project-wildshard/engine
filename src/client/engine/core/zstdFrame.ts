/** Whole lane blocks are deliberately bounded before dispatch to the decoder. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Admit one dictionary-free, size-declared Zstd frame, including its complete
 * block envelope. Other magic returns null; malformed Zstd never falls back.
 * The decoder still validates compressed block contents and checksums. */
export function zstdLaneSize(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x28 || bytes[1] !== 0xb5 || bytes[2] !== 0x2f || bytes[3] !== 0xfd) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 4;
  const read = (count: number): number => {
    if (at + count > bytes.length) throw new Error('Truncated Zstd lane frame');
    let value = 0;
    for (let index = 0; index < count; index++) value += view.getUint8(at++) * 2 ** (index * 8);
    if (!Number.isSafeInteger(value)) throw new Error('Unsafe Zstd lane size');
    return value;
  };
  const descriptor = read(1), single = (descriptor & 0x20) !== 0, sizeFlag = descriptor >>> 6;
  if ((descriptor & 0x1b) !== 0) throw new Error('Unsupported Zstd lane frame'); // Reserved bits and dictionary ids.
  if (!single) {
    const window = read(1), base = 2 ** (10 + (window >>> 3));
    if (base + base / 8 * (window & 7) > MAX_BYTES) throw new Error('Zstd lane window exceeds limit');
  }
  if (!single && sizeFlag === 0) throw new Error('Zstd lane frame needs its decoded size');
  const size = read(sizeFlag === 0 ? 1 : sizeFlag === 1 ? 2 : sizeFlag === 2 ? 4 : 8) + (sizeFlag === 1 ? 256 : 0);
  if (size > MAX_BYTES || bytes.length > MAX_BYTES || size % 4 !== 0) throw new Error('Zstd lane frame exceeds bounded whole words');
  let last = false;
  while (!last) {
    const block = read(3), kind = (block >>> 1) & 3, length = block >>> 3;
    if (kind === 3 || length > 131072) throw new Error('Invalid Zstd lane block');
    last = (block & 1) !== 0;
    at += kind === 1 ? 1 : length;
    if (at > bytes.length) throw new Error('Truncated Zstd lane block');
  }
  if ((descriptor & 4) !== 0) read(4);
  if (at !== bytes.length) throw new Error('Zstd lane frame has trailing bytes');
  return size;
}
