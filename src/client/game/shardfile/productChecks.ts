import type { Shardfile } from '@wildshard/format/shardSchema';
import type { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import type { TextureTranscodeSupport } from '@wildshard/format/contentBounds';
import type { preflightDeclaredCosts } from '@wildshard/format/assetAdmission';
import { isBuildValidatedOutput } from '../../../shared/game/shardfile/outputDescriptor';

/** Node/CI parses unproved models; browser authority comes only from the exact build proof. */
export async function parseCheckedProduct(input: unknown): Promise<Shardfile> {
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  return (await import('@wildshard/format/shardSchema')).parseShardfile(input);
}

/** Exposed browser roots must still pass the caller's complete source rehash
 * before asset reads. Node/CI retains the original graph/decoder checks. */
export async function prepareCheckedProduct(source: Shardfile): Promise<boolean> {
  if (!(import.meta.env?.SSR ?? true)) {
    if (!isBuildValidatedOutput(source)) throw new Error('Shardfile needs server validation before client admission');
    return false;
  }
  const checked = await import('@wildshard/format/product');
  await checked.prepareAssetDecoders();
  checked.preflightAssetGraph(source);
  return true;
}

/** Unknown costs require checked Node ingestion, never a browser fallback. */
export async function checkedProductCosts(source: Shardfile, memory: MemoryAdmission | undefined): Promise<ReturnType<typeof preflightDeclaredCosts>['worst']> {
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  return (await import('@wildshard/format/assetAdmission')).preflightDeclaredCosts(source, memory).worst;
}

/** Original complete Node/CI asset validation, after byte verification and before publication. */
export async function validateCheckedProductAssets(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, hash: (bytes: Uint8Array) => string,
  memory: MemoryAdmission | undefined, textures: TextureTranscodeSupport | undefined, sections: ReadonlyMap<string, unknown> | undefined, decodersReady: boolean): Promise<void> {
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  if (!decodersReady) await (await import('@wildshard/format/product')).prepareAssetDecoders();
  const { validateShardfileAssets } = await import('@wildshard/format/assetAdmission');
  const { scriptAdmissionRows } = await import('@wildshard/format/scriptContract');
  validateShardfileAssets(source, assets, hash, memory, textures, scriptAdmissionRows(sections));
}
