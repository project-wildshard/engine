import * as v from 'valibot';
import {RevisionNumberSchema as UploadNumberSchema} from '@wildshard/format/uploadWire';
import type {WireUploadIdentity} from '../../shared/game/grid/uploadIdentity';

type OptionalNumber = v.OptionalSchema<v.GenericSchema<number>, undefined>;
type OptionalString = v.OptionalSchema<v.StringSchema<undefined>, undefined>;
const number = v.optional(UploadNumberSchema);
const version = v.optional(v.string());

export const wireUploadFields: {
  readonly uploadNumber: OptionalNumber;
  readonly shardVersion: OptionalString;
  readonly revision: OptionalNumber;
  readonly version: OptionalString;
} = {uploadNumber: number, shardVersion: version, revision: number, version};

export function hasUploadNumber(row: WireUploadIdentity): boolean {
  return row.uploadNumber !== undefined || row.revision !== undefined;
}
