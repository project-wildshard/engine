export interface DecodeRequest { id: number; blob: Blob; options: ImageBitmapOptions }
function request(value: unknown): value is DecodeRequest {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'number' && Number.isSafeInteger(value.id)
    && 'blob' in value && value.blob instanceof Blob
    && 'options' in value && typeof value.options === 'object' && value.options !== null;
}
// One native decode at a time bounds decoded intermediates; only the completed
// bitmap crosses to the page, with ownership transferred rather than copied.
let tail = Promise.resolve();
self.onmessage = (event: MessageEvent<unknown>): void => {
  const input = event.data;
  if (!request(input)) return;
  tail = tail.then(async () => {
    let image: ImageBitmap | undefined;
    try {
      image = await createImageBitmap(input.blob, input.options);
      self.postMessage({ id: input.id, image }, { transfer: [image] });
      image = undefined;
    } catch (error) {
      image?.close();
      self.postMessage({ id: input.id, error: error instanceof Error ? error.message : String(error),
        unsupported: typeof createImageBitmap !== 'function' }, { transfer: [] });
    }
    return undefined;
  });
};
