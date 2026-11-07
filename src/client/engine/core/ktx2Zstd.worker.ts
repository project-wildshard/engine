import { ZSTDDecoder } from 'three/examples/jsm/libs/zstddec.module.js';

/** one KTX2's zstd-supercompressed levels to decode (`ktx2Zstd.ts`); each level's bytes come transferred */
export interface ZstdRequest { id: number; levels: { data: Uint8Array; size: number }[] }
function request(value: unknown): value is ZstdRequest {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'number' || !('levels' in value) || !Array.isArray(value.levels)) return false;
  const levels: readonly unknown[] = value.levels;
  return levels.every(level => typeof level === 'object' && level !== null && 'data' in level && level.data instanceof Uint8Array
    && 'size' in level && typeof level.size === 'number' && Number.isSafeInteger(level.size) && level.size >= 0);
}
let decoder: Promise<ZSTDDecoder> | null = null;
// One file at a time: its decoded levels are the only large intermediates, and they go to the page by transfer.
let tail = Promise.resolve();
self.onmessage = (event: MessageEvent<unknown>): void => {
  const input = event.data;
  if (!request(input)) return;
  tail = tail.then(async () => {
    try {
      decoder ??= (async (): Promise<ZSTDDecoder> => { const made = new ZSTDDecoder(); await made.init(); return made; })();
      const zstd = await decoder;
      const levels = input.levels.map(level => zstd.decode(level.data, level.size));
      self.postMessage({ id: input.id, levels }, { transfer: levels.map(level => level.buffer) });
    } catch (error) {
      self.postMessage({ id: input.id, error: error instanceof Error ? error.message : String(error) }, { transfer: [] });
    }
    return undefined;
  });
};
