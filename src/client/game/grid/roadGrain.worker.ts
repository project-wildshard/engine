import { ROAD_GRAIN_PLANES, roadGrainSteps } from './roadGrain';

self.onmessage = (event: MessageEvent<unknown>): void => {
  const kind = event.data;
  if (kind !== 'asphalt' && kind !== 'junction') return;
  try {
    const { width, height, seed } = ROAD_GRAIN_PLANES[kind];
    const context = new OffscreenCanvas(width, height).getContext('2d');
    if (context === null) throw new Error('Worker road grain has no 2D canvas');
    const steps = roadGrainSteps(context, width, height, seed);
    let next = steps.next(); while (!next.done) next = steps.next();
    const pixels = context.getImageData(0, 0, width, height).data;
    self.postMessage({ kind, pixels, fillStyle: next.value }, { transfer: [pixels.buffer] });
  } catch (error) {
    self.postMessage({ kind, error: error instanceof Error ? error.message : String(error) }, { transfer: [] });
  }
};
