import { serializeSimSnapshot, type SimSnapshotBytes } from '@wildshard/engine/sim/snapshot';

export interface SaveCodecRequest { readonly id: number; readonly snapshot: SimSnapshotBytes }
export type SaveCodecReply = { readonly id: number; readonly wire: string } | { readonly id: number; readonly error: string };

const worker = globalThis as typeof globalThis & { postMessage: (reply: SaveCodecReply, transfer: Transferable[]) => void };
self.onmessage = (event: MessageEvent<SaveCodecRequest>): void => {
  const { id, snapshot } = event.data;
  try {
    worker.postMessage({ id, wire: serializeSimSnapshot(snapshot) }, []);
  } catch (error) {
    worker.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
};
