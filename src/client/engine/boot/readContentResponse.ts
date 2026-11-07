/** Bounded cached-body reader: `maximum` comes from the file declaration.
 * Copy each streamed chunk immediately, rather than retaining a second whole body
 * until concatenation. The caller compares the final declared length. */
export async function readContentResponse(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw new Error(`Read failed: ${response.url}`);
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader(), bytes = new Uint8Array(maximum);
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (part.value.byteLength > maximum - length) throw new Error('Read exceeds its declared size');
      bytes.set(part.value, length); length += part.value.byteLength;
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  return length === maximum ? bytes : bytes.subarray(0, length);
}
