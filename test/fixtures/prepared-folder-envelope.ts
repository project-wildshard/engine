import { loadHeadlessFolder } from '../../src/server/host/headlessFolder';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { builtFolder } from './builtFolder';

/** Read the normal prepare output through strict native admission. Never build
 * an author project or fall back to stale bytes during test collection. */
export async function preparedFolderEnvelope(slug: string, needed: (name: string) => boolean) {
  const product = await loadHeadlessFolder(builtFolder(slug));
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing prepared product inventory');
  const namedFiles = descriptor.index.files.filter(file => file.name !== undefined);
  const assets = new Map<string, Uint8Array>();
  for (const file of namedFiles) {
    if (file.name !== undefined && needed(file.name)) assets.set(file.hash, await product.file(file.name));
  }
  return {shard: product.shardfile, output: {namedFiles}, assets};
}
