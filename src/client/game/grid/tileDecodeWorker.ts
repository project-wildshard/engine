/**
 * SF18b's decode worker: terrain tile wire bytes in (transferred), the validated `TerrainTileData` out with its sample
 * arrays transferred back, so the main thread only uploads. Started by `TileDecoder` (`./tileDecoder`).
 */
import { decodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import type { TileDecodeReply } from './tileDecoder';

function reply(message: TileDecodeReply, transfer: Transferable[]): void {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const request = event.data;
  if (typeof request !== 'object' || request === null || !('id' in request) || !('bytes' in request) || typeof request.id !== 'number' || !(request.bytes instanceof ArrayBuffer)) return;
  const id = request.id;
  try {
    const data = decodeTerrainTile(new Uint8Array(request.bytes)), transfer: Transferable[] = [data.heights.buffer];
    if (data.colours !== undefined) transfer.push(data.colours.buffer);
    reply({ id, data }, transfer);
  } catch (error) { reply({ id, error: error instanceof Error ? error.message : String(error) }, []); }
};
