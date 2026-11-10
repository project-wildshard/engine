import { installWorkerBootTiming } from '../../../shared/engine/boot/workerTiming';

installWorkerBootTiming('image-decode');
export interface DecodeRequest { id: number; blob: Blob; options: ImageBitmapOptions }
/** NB2: one texture-array layer's texels (`size`², rows flipped so its top is v = 1), its alpha from `alpha`'s red channel
 *  or 128 without one: what the page's lent-layers loader read back on its main thread, here beside the decode. */
export interface LayerRequest { id: number; layer: { rgb: Blob; alpha: Blob | null; size: number } }
function request(value: unknown): value is DecodeRequest {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'number' && Number.isSafeInteger(value.id)
    && 'blob' in value && value.blob instanceof Blob
    && 'options' in value && typeof value.options === 'object' && value.options !== null;
}
function layerRequest(value: unknown): value is LayerRequest {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || !('layer' in value)) return false;
  const layer = value.layer;
  return typeof layer === 'object' && layer !== null && 'rgb' in layer && layer.rgb instanceof Blob && 'alpha' in layer && (layer.alpha === null || layer.alpha instanceof Blob)
    && 'size' in layer && typeof layer.size === 'number' && Number.isSafeInteger(layer.size) && layer.size > 0 && layer.size <= 4096;
}
/** an image's texels at `size`², rows flipped (the page loader's `pixels`) */
function pixels(image: ImageBitmap, size: number): Uint8ClampedArray {
  const c2 = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
  if (c2 === null) throw new Error('Layer texels need a 2d canvas');
  c2.setTransform(1, 0, 0, -1, 0, size); c2.drawImage(image, 0, 0, size, size);
  return c2.getImageData(0, 0, size, size).data;
}
async function layerTexels(layer: LayerRequest['layer']): Promise<Uint8ClampedArray> {
  const colour = await createImageBitmap(layer.rgb);
  let cover: ImageBitmap | null = null;
  try {
    cover = layer.alpha === null ? null : await createImageBitmap(layer.alpha);
    const data = pixels(colour, layer.size), mask = cover === null ? null : pixels(cover, layer.size);
    for (let k = 0; k < layer.size * layer.size; k++) data[k * 4 + 3] = mask === null ? 128 : mask[k * 4] ?? 128;
    return data;
  } finally { colour.close(); cover?.close(); }
}
// One native decode at a time bounds decoded intermediates; only the completed
// bitmap (or a layer's texels) crosses to the page, with ownership transferred rather than copied.
let tail = Promise.resolve();
self.onmessage = (event: MessageEvent<unknown>): void => {
  const input = event.data;
  if (layerRequest(input)) {
    tail = tail.then(async () => {
      try {
        const texels = await layerTexels(input.layer);
        self.postMessage({ id: input.id, texels }, { transfer: [texels.buffer] });
      } catch (error) {
        self.postMessage({ id: input.id, error: error instanceof Error ? error.message : String(error),
          unsupported: typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function' }, { transfer: [] });
      }
      return undefined;
    });
    return;
  }
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
