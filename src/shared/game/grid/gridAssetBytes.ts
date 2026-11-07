// oxlint-disable-next-line typescript/unbound-method -- Snapshot native identity only; bind the concrete reader before invoking it.
const directRead = typeof ReadableStreamBYOBReader === 'undefined' ? undefined : ReadableStreamBYOBReader.prototype.read;
/** Read one build-addressed grid asset, refusing size, path and digest changes. */
export async function readGridAssetBytes(address: { readonly url: string; readonly bytes: number; readonly sha256: string }, read: (url: string) => Promise<Response>, kind: 'seams' | 'strips' | 'seam-plans'): Promise<Uint8Array<ArrayBuffer>> {
  const path = kind === 'seams' ? /^\/assets\/grid-seams-[a-f0-9]{8}\.json$/u : kind === 'seam-plans' ? /^\/assets\/grid-seam-plans-[a-f0-9]{8}\.json$/u : /^\/assets\/grid-strip-(?:(?:book|page)-[a-f0-9]{8}\.json|mesh-[a-f0-9]{8}\.bin)$/u;
  const label = kind === 'seams' ? 'Grid seam data' : kind === 'seam-plans' ? 'Grid seam plans' : 'Grid strip data';
  if (!path.test(address.url) || !/^[a-f0-9]{64}$/u.test(address.sha256)
    || !address.url.includes(address.sha256.slice(0, 8))
    || !Number.isSafeInteger(address.bytes) || address.bytes <= 0 || address.bytes > 16 * 1024 * 1024) throw new Error(kind === 'seams' ? 'Invalid grid seam address' : 'Invalid grid strip address');
  const response = await read(address.url);
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  if (response.body === null) throw new Error(`${label} body is missing`);
  let direct: ReadableStreamBYOBReader | undefined;
  // Native byte streams can fill the admitted backing without a second JS copy.
  // Ordinary cached/custom streams keep the original default-reader path.
  if (directRead !== undefined) {
    try {
      const candidate = response.body.getReader({ mode: 'byob' });
      // A custom read need not transfer private storage as the native method
      // does. Keep its response on the original copying path.
      if (candidate.read === directRead) direct = candidate; else candidate.releaseLock();
    } catch { /* Capability negotiation only; the default reader still owns every failure. */ }
  }
  const wire = direct === undefined ? await readChunks(response.body, address.bytes, label) : await readDirect(direct, address.bytes, label);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wire.buffer));
  if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== address.sha256) throw new Error(`${label} differs from the build`);
  return wire;
}
async function readChunks(body: ReadableStream<Uint8Array>, bytes: number, label: string): Promise<Uint8Array<ArrayBuffer>> {
  const wire = new Uint8Array(bytes), reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (part.value.length > wire.length - size) throw new Error(`${label} size differs from the build`);
      wire.set(part.value, size); size += part.value.length;
    }
    if (size !== wire.length) throw new Error(`${label} size differs from the build`);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  return wire;
}
async function readDirect(reader: ReadableStreamBYOBReader, bytes: number, label: string): Promise<Uint8Array<ArrayBuffer>> {
  let wire = new Uint8Array(bytes), size = 0;
  try {
    if (directRead === undefined) throw new Error('Missing native byte reader');
    const read = directRead.bind(reader);
    for (;;) {
      // A separate one-byte EOF probe preserves the completed backing: BYOB
      // transfers its input buffer even when the next read reaches EOF.
      const full = size === bytes, part = await read(full ? new Uint8Array(1) : wire.subarray(size));
      if (part.done) break;
      if (full || part.value.byteLength > bytes - size) throw new Error(`${label} size differs from the build`);
      const length = part.value.byteLength;
      wire = new Uint8Array(part.value.buffer, 0, bytes); size += length;
    }
    if (size !== bytes) throw new Error(`${label} size differs from the build`);
    return wire;
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
}
