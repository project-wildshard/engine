let context: OffscreenCanvasRenderingContext2D | undefined;

export function sampleWatchBitmap(image: ImageBitmap): Uint8ClampedArray | null {
  const { width, height } = image;
  const ctx = context ?? new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  context = ctx;
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
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
