// oxlint-disable-next-line import/no-nodejs-modules -- Ring 1 must actually use the server-only pin.
import { existsSync, readFileSync } from 'node:fs';
import { builtFolder as fullFolder } from '../builtFolder';
import { outputDescriptor, serverReadsFile } from '../../../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../../../src/shared/game/shardfile/shardFolder';

export function builtFolder(slug: string): string {
  const slice = `out/.slices/${slug}`;
  if (process.env['WILDSHARD_RING'] === '1' && existsSync(`${slice}/shard.json`)) return slice;
  return fullFolder(slug);
}

/** Match the standalone worker's eager asset class; named data is read and verified through Product. */
export function runtimeAssets(product: ShardFolder, directory: string): Map<string, Uint8Array> {
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing admitted runtime inventory');
  return new Map(descriptor.index.files
    .filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
}
