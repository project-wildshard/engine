/** Pure strict-author/runtime-generated hashing; no worker or storage owner. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  // DW12: a view over a larger buffer (a capture arena's body) is digested in place, not copied first
  const input = bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
