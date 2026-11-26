import {StandaloneCatalogueSchema as FormatCatalogueSchema, type StandaloneCatalogue as FormatCatalogue} from '@wildshard/format/standaloneCatalogue';
import {parse} from 'valibot';
import {catalogueUpload, type UploadIdentity, type WireUploadIdentity} from '../shared/game/grid/uploadIdentity.ts';

type WireHead = WireUploadIdentity & Omit<FormatCatalogue['shards'][number], 'revision'>;
export type StandaloneCatalogue = Omit<FormatCatalogue, 'shards'> & {shards: (Omit<WireHead, keyof WireUploadIdentity> & UploadIdentity)[]};

/** The pinned format validates the legacy wire shape. Keep that adapter at the boundary. */
export function parseStandaloneCatalogue(value: unknown): StandaloneCatalogue {
  if (typeof value !== 'object' || value === null || !('shards' in value) || !Array.isArray(value.shards)) throw new Error('Invalid standalone catalogue');
  const heads = (value.shards as WireHead[]).map(catalogueUpload);
  const validated = parse(FormatCatalogueSchema, {...value, shards: heads.map(({uploadNumber, shardVersion: _, ...row}) => ({...row, revision: uploadNumber}))});
  return {...validated, shards: heads};
}
