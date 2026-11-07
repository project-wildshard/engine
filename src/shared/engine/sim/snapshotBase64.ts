const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const values = new Int16Array(128).fill(-1);
for (let i = 0; i < alphabet.length; i++) values[alphabet.codePointAt(i) ?? 0] = i;
const value = (code: number | undefined): number => code !== undefined && code < values.length ? values[code] ?? -1 : -1;

/** Strict canonical base64: validate every character and padding bit before
 * allocating, then fill one owned byte array without an encode roundtrip. */
export function unpackSnapshotBase64(data: string): Uint8Array<ArrayBuffer> {
  if (data.length % 4 !== 0) throw new RangeError('Invalid snapshot base64');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const content = data.length - padding;
  for (let i = 0; i < content; i++) if (value(data.codePointAt(i)) < 0) throw new RangeError('Invalid snapshot base64');
  if (padding === 2 && (value(data.codePointAt(content - 1)) & 15) !== 0
    || padding === 1 && (value(data.codePointAt(content - 1)) & 3) !== 0) throw new RangeError('Noncanonical snapshot base64');
  const bytes = new Uint8Array(data.length / 4 * 3 - padding);
  let out = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = value(data.codePointAt(i)), b = value(data.codePointAt(i + 1));
    const c = i + 2 < content ? value(data.codePointAt(i + 2)) : 0, d = i + 3 < content ? value(data.codePointAt(i + 3)) : 0;
    bytes[out++] = (a << 2) | (b >>> 4);
    if (out < bytes.length) bytes[out++] = ((b & 15) << 4) | (c >>> 2);
    if (out < bytes.length) bytes[out++] = ((c & 3) << 6) | d;
  }
  return bytes;
}
