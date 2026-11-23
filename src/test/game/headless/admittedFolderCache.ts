// oxlint-disable-next-line import/no-nodejs-modules -- Exact product identity comes from its content-addressed index.
import { readFile } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Distinguish full products and slices with identical slugs.
import { resolve, sep } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve native product URLs.
import { pathToFileURL } from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Check the loaded descriptor against the cache identity.
import { createHash } from 'node:crypto';
import { loadHeadlessFolder } from '../../../server/host/headlessFolder';
import { carryOutputDescriptor, outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { folderClosureFile, type ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { shardFolderData } from '../../../shared/game/shardfile/folderData';
import { nodeNamedJsonCheck } from '../../../shared/game/shardfile/outputChecksNode';

export type FolderMode = 'full' | 'slice' | 'server';

/** A test file's admitted data only. Each borrower owns its source and byte arrays;
 * worlds, residents and RNG never enter this cache. Rejected loads can retry. */
export function createAdmittedFolderCache(load: typeof loadHeadlessFolder = loadHeadlessFolder) {
  const products = new Map<string, Promise<{ product: ShardFolder; bytes: Map<string, Promise<Uint8Array>> }>>();
  return async (directory: string, mode: FolderMode): Promise<{ product: ShardFolder; assets: Map<string, Uint8Array> }> => {
    const root = resolve(directory);
    // Read the index each time: a changed product at the same path cannot reuse
    // a previous admission, even when its slug and revision stayed the same.
    const identity = await readFile(`${root}/shard.json`, 'utf8');
    const key = JSON.stringify([root, mode, identity]);
    let pending = products.get(key);
    if (pending === undefined) {
      pending = load(root).then(product => {
        if (outputDescriptor(product.shardfile)?.indexHash !== createHash('sha256').update(identity).digest('hex')) throw new Error('Headless product changed during cache admission');
        return { product, bytes: new Map<string, Promise<Uint8Array>>() };
      });
      products.set(key, pending);
      void pending.catch(() => { products.delete(key); });
    }
    const held = await pending;
    const bytes = async (ref: string): Promise<Uint8Array> => {
      let reading = held.bytes.get(ref);
      if (reading === undefined) {
        reading = folderClosureFile(held.product, ref).then(value => value.slice());
        held.bytes.set(ref, reading);
        void reading.catch(() => { held.bytes.delete(ref); });
      }
      return (await reading).slice();
    };
    const source = structuredClone(held.product.shardfile);
    carryOutputDescriptor(held.product.shardfile, source);
    const product = shardFolderData(source, pathToFileURL(root + sep).href, bytes, true, false, nodeNamedJsonCheck, { files: true });
    const descriptor = outputDescriptor(source);
    if (descriptor === undefined) throw new Error('Missing admitted headless inventory');
    // Full inventory in every mode: the worker's parent admits it (createNativeProofWorker) and the worker
    // must receive page assets too, not a filtered server-only bank.
    const assets = new Map(await Promise.all(descriptor.index.files.map(async file => {
      const ref = file.commons === true ? `commons:${file.hash}` : file.hash;
      return [ref, await bytes(ref)] as const;
    })));
    return { product, assets };
  };
}

export const admittedFolder = createAdmittedFolderCache();
