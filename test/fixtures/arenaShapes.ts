// oxlint-disable-next-line import/no-nodejs-modules -- Decode the original Places fixture, never a runtime fallback.
import { inflateSync } from 'node:zlib';
import { prepareAssetDecoders } from '@wildshard/format/product';
import { unshuffleLanes } from '../../src/client/engine/core/deflate';
import { originalPlaceBinary } from './nalati-original-place-binary';

/** The room upload tests need original shapes, without a world or species catalogue. */
export async function installArenaShapes(): Promise<void> {
  await prepareAssetDecoders();
  const { SHAPES, SHAPE_BYTES } = await import('./nalatiShapes');
  if (!SHAPES.ready) await SHAPES.load(new Map([...SHAPE_BYTES,
    ['/assets/nalati/baked/places.bin', unshuffleLanes(new Uint8Array(inflateSync(await originalPlaceBinary())))]]));
}
