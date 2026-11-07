import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { builtProduct } from './builtProduct';

/** Read the normal prepare output through strict native admission. Never build
 * an author project or fall back to stale bytes during test collection. */
export async function preparedProductEnvelope(slug: string, needed: (name: string) => boolean) {
  const product = await loadHeadlessProduct(builtProduct(slug));
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing prepared product inventory');
  const namedFiles = descriptor.index.files.filter(file => file.name !== undefined);
  const assets = new Map<string, Uint8Array>();
  for (const file of namedFiles) {
    if (file.name !== undefined && needed(file.name)) assets.set(file.hash, await product.file(file.name));
  }
  return {shard: product.shardfile, output: {namedFiles}, assets};
}
