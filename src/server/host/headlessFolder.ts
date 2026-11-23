// oxlint-disable-next-line import/no-nodejs-modules -- The Node proof loader reads only the chosen local output inventory.
import { readFile, realpath, stat } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve bounded output paths and refuse escaping symlinks.
import { basename, resolve, sep } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Native admission verifies the same SHA-256 addresses as the browser.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The native product exposes local content-addressed blob URLs.
import { pathToFileURL } from 'node:url';
import { SHARDFILE_ADMISSION_LIMITS } from '@wildshard/format/admissionLimits';
import { isOutputIndex } from '@wildshard/format/outputAddress';
import { parseShardfile } from '@wildshard/format/shardSchema';
import { carryOutputDescriptor, resolveOutputDescriptor, outputDescriptor } from '@wildshard/engine/game/shardfile/outputDescriptor';
import { serverReadsFile } from '@wildshard/format/serverReads';
import { serverSkinRigs } from '@wildshard/engine/game/shardfile/serverSkinRigs';
import { nodeOutputDescriptorChecks, nodeNamedJsonCheck } from '@wildshard/engine/game/shardfile/outputChecksNode';
import { shardFolderData } from '@wildshard/engine/game/shardfile/folderData';
import { folderClosureFile, type ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import type { HeadlessRuntimeInput } from './headlessRuntime';

/** Read a local format-2 output for native proofs, including checked custom sections. No runtime code is imported. */
export async function loadHeadlessFolder(outDir: string): Promise<ShardFolder> {
  let root: string;
  try { root = await realpath(outDir); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') throw new Error(`${basename(resolve(outDir))}: no built shard was loaded (run \`wildshard build ${basename(resolve(outDir))}\`)`, { cause: error });
    throw error;
  }
  const base = pathToFileURL(root + sep).href;
  const hash = (bytes: Uint8Array): Promise<string> => Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
  const read = async (path: string, maximum: number): Promise<Uint8Array> => {
    const file = await realpath(resolve(root, path));
    if (!file.startsWith(root + sep)) throw new Error('Native product path escapes its output');
    const info = await stat(file);
    if (!info.isFile() || info.size > maximum) throw new Error('Native product exceeds its byte cap');
    const bytes = await readFile(file);
    if (bytes.length > maximum) throw new Error('Native product exceeds its byte cap');
    return Uint8Array.from(bytes);
  };
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('shard.json', SHARDFILE_ADMISSION_LIMITS.sourceBytes)));
  if (!isOutputIndex(input)) throw new Error('Native product requires a format-2 output');
  const assembled = await resolveOutputDescriptor(input, { offline: false, hash, read, checks: nodeOutputDescriptorChecks });
  const source = parseShardfile(assembled, outputDescriptor(assembled)?.sections);
  carryOutputDescriptor(assembled, source);
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) throw new Error('Native product has no verified index');
  const files = new Map<string, { readonly path: string; readonly hash: string; readonly compressed: number }>(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, file]));
  for (const file of descriptor.index.admission.server ?? []) files.set(file.hash, { path: file.path, hash: file.hash, compressed: file.bytes });
  return shardFolderData(source, base, async ref => {
    const file = files.get(ref);
    if (file === undefined) throw new Error('Undeclared native product blob');
    const bytes = await read(file.path, file.compressed);
    if (bytes.length !== file.compressed || await hash(bytes) !== file.hash) throw new Error('Native product blob hash or size mismatch');
    return bytes;
  }, true, false, nodeNamedJsonCheck, { files: true });
}

/** Admit an extracted cooked server product through the production reader.
 * Only server assets are read; the caller owns physics and world lifetime. */
export async function loadCookedFolder(directory: string, rapier: Rapier, authorSlug?: string): Promise<HeadlessRuntimeInput> {
  const product = await loadHeadlessFolder(directory), shard = product.shardfile;
  // oxlint-disable-next-line wildshard/no-shard-branch -- Compare two runtime identities, with no shard-specific policy.
  if (authorSlug !== undefined && shard.identity.slug !== authorSlug) throw new Error('Dev server product has the wrong identity');
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Cooked world requires a verified output descriptor');
  const entries = await Promise.all(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider)).map(async file => {
    const ref = file.commons === true ? `commons:${file.hash}` : file.hash;
    return [ref, await folderClosureFile(product, ref)] as const;
  }));
  const assets = new Map(entries);
  // Native creature height and hit volumes need the selected skin rigs (AP36c: `serverSkinRigs`, the worker's and the cook's
  // too). Static GLBs, materials and textures still belong to the page. An author's own product must hold them; a room's
  // pack cooked before the cook carried rigs has none, and its world says which species misses one, as it did before.
  await Promise.all([...serverSkinRigs(shard)].filter(ref => !assets.has(ref)).map(async ref => {
    const bytes = authorSlug !== undefined ? await folderClosureFile(product, ref) : await folderClosureFile(product, ref).catch(() => undefined);
    if (bytes !== undefined) assets.set(ref, bytes);
  }));
  return { shard, assets, product, rapier };
}
