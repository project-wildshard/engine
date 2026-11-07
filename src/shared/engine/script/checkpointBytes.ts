// One small ASCII scratch, decoded a chunk at a time: a checkpoint's text never needs a buffer four times the memory.
const scratch = new Uint8Array(32768), decoder = new TextDecoder();

/** Exact JSON byte-array text without a boxed number[] per Wasm memory.
 * Keep the historical replay wire while writing directly into a reused ASCII scratch. */
export function checkpointByteText(bytes: Uint8Array): string {
  let text = '[', at = 0;
  for (let index = 0; index < bytes.length; index++) {
    // a value writes at most four bytes (a comma and three digits)
    if (at > scratch.length - 4) { text += decoder.decode(scratch.subarray(0, at)); at = 0; }
    const value = bytes[index] ?? 0;
    if (index > 0) scratch[at++] = 44;
    if (value >= 100) scratch[at++] = 48 + Math.floor(value / 100);
    if (value >= 10) scratch[at++] = 48 + Math.floor(value / 10) % 10;
    scratch[at++] = 48 + value % 10;
  }
  return `${text}${decoder.decode(scratch.subarray(0, at))}]`;
}
