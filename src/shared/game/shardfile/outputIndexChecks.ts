import type { OutputIndex } from '@wildshard/format/outputIndex';

/** Unknown metadata needs checked Node ingestion. A browser first proves its
 * exact build-owned index hash; it never loads the full host grammar. */
export async function readCheckedOutputIndex(input: unknown): Promise<OutputIndex> {
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  return (await import('@wildshard/format/outputIndex')).parseOutputIndex(input);
}
