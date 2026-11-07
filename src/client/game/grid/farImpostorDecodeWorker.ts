/**
 * G539's impostor decode worker: a baked far impostor PNG in (transferred), its RGBA 5551 texels out (transferred), so
 * the image decode, the pixel read-back and the pack never touch the main thread. Started by `farImpostorView.ts`.
 */
import { packFarImpostor, type FarImpostorDecodeReply } from './farImpostorPack';

function reply(message: FarImpostorDecodeReply, transfer: Transferable[]): void {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const request = event.data;
  if (typeof request !== 'object' || request === null || !('id' in request) || !('bytes' in request) || !('width' in request) || !('height' in request)
    || typeof request.id !== 'number' || !(request.bytes instanceof ArrayBuffer) || typeof request.width !== 'number' || typeof request.height !== 'number') return;
  const { id, bytes, width, height } = request;
  void (async (): Promise<void> => {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      try {
        if (bitmap.width !== width || bitmap.height !== height) throw new Error(`Far impostor is ${String(bitmap.width)} × ${String(bitmap.height)}, its row says ${String(width)} × ${String(height)}`);
        const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
        if (context === null) throw new Error('No 2D context in the impostor worker');
        context.drawImage(bitmap, 0, 0);
        const texels = packFarImpostor(context.getImageData(0, 0, width, height).data, width, height);
        reply({ id, texels }, [texels.buffer]);
      } finally { bitmap.close(); }
    } catch (error) { reply({ id, error: error instanceof Error ? error.message : String(error) }, []); }
  })();
};
