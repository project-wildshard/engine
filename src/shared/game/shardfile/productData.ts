import type { Shardfile } from '@wildshard/format/shardSchema';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { outputBlobUrl, outputDescriptor } from './outputDescriptor';
import { createShardProduct, type ShardProduct, type ShardProductInput } from './shardProduct';

/** Bind the verified reader to the synchronous runtime API. No renderer or browser enters native preparation.
 * `server` admits the J91 server class into the names; a browser caller never passes it. */
export function shardProductData(source: Shardfile, base: string, read: (hash: string) => Promise<Uint8Array>, check = true, builtJson = false, jsonCheck?: ShardProductInput['jsonCheck'], server?: { readonly files: true }): ShardProduct {
  const descriptor = outputDescriptor(source);
  const files = new Map(descriptor?.index.files.flatMap(file => file.name === undefined ? [] : [[file.name, {
    hash: file.commons === true ? `commons:${file.hash}` : file.hash,
    url: outputBlobUrl(source, file.commons === true ? `commons:${file.hash}` : file.hash, base),
    ...(file.jsonSchema === undefined ? {} : { jsonSchema: file.jsonSchema }),
  }] as const]));
  // J91: only a server reader asks for the server class. A client's product has no such name, so `file()` refuses it.
  if (server?.files === true) for (const file of descriptor?.index.admission.server ?? []) files.set(file.name, { hash: file.hash, url: new URL(file.path, base).href,
    ...(file.schema === undefined ? {} : { jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', $comment: file.schema } }) });
  // Native APIs may supply an already checked in-memory Shardfile. This does
  // not read an older disk format or fabricate custom sections/logical names.
  return createShardProduct({ slug: source.identity.slug, revision: source.identity.revision, shardfile: source,
    sections: descriptor?.sections ?? outputSectionPayloads(source), files, read, check, builtJson, ...(jsonCheck === undefined ? {} : { jsonCheck }) });
}
