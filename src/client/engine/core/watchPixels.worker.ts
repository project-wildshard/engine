export function sampleWatchBitmap(image: ImageBitmap): Uint8ClampedArray | null {
  const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height).data;
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const image = event.data;
  if (typeof ImageBitmap !== 'function' || !(image instanceof ImageBitmap)) { self.postMessage(null, { transfer: [] }); return; }
  try {
    const pixels = sampleWatchBitmap(image);
    self.postMessage(pixels, { transfer: pixels === null ? [] : [pixels.buffer] });
  } catch { self.postMessage(null, { transfer: [] }); }
  finally { image.close(); }
};
