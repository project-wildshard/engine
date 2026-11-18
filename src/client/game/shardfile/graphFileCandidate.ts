import { GRAPH_ADMISSION_LIMITS } from '@wildshard/format/materialGraph';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** EM24 (meta ENGINE-MEMORY): a JSON file small enough to be a material graph file. Admission refuses a larger graph file
 *  and `graphFileJson` throws for one, so the lazy graph compiles' retained JSON (`clientMaterials`, the grid's input
 *  leases) never needs a bigger document: a zone's ground layout or placement pages are read again from the cache. */
export function graphFileCandidate(file: Pick<Shardfile['files'][number], 'kind' | 'compressed'>): boolean {
  return file.kind === 'json' && file.compressed <= GRAPH_ADMISSION_LIMITS.bytes;
}
