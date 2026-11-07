const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Original bottom-up RG8 coverage words, using a fixed transient lookup on ordinary aligned little-endian storage. */
export function packRoadSignPixels(pixels: Uint8ClampedArray, width: number, height: number, red: Uint8Array, green: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || !Number.isSafeInteger(width * height) || pixels.length !== width * height * 4 || red.length !== 256 || green.length !== 256) throw new RangeError('Invalid road sign coverage planes');
  const data = new Uint8Array(width * height * 2);
  if (LITTLE_ENDIAN && pixels.byteOffset % 2 === 0) {
    const pairs = new Uint16Array(pixels.buffer, pixels.byteOffset, pixels.length / 2), output = new Uint16Array(data.buffer), lookup = new Uint16Array(65536);
    for (let g = 0; g < 256; g++) for (let r = 0; r < 256; r++) lookup[g * 256 + r] = (red[r] ?? 0) | ((green[g] ?? 0) << 8);
    for (let y = 0; y < height; y++) {
      const from = (height - 1 - y) * width * 2, to = y * width;
      for (let x = 0; x < width; x++) output[to + x] = lookup[pairs[from + x * 2] ?? 0] ?? 0;
    }
  } else {
    for (let y = 0; y < height; y++) {
      const from = (height - 1 - y) * width * 4, to = y * width * 2;
      for (let x = 0; x < width; x++) { data[to + x * 2] = red[pixels[from + x * 4] ?? 0] ?? 0; data[to + x * 2 + 1] = green[pixels[from + x * 4 + 1] ?? 0] ?? 0; }
    }
  }
  return data;
}
