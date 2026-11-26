// J524: deployed catalogue readers accept the old wire fields during rollout.
export interface UploadIdentity {
  readonly uploadNumber: number;
  readonly shardVersion?: string | undefined;
}
export interface WireUploadIdentity {
  readonly uploadNumber?: number | undefined;
  readonly shardVersion?: string | undefined;
  readonly revision?: number | undefined;
  readonly version?: string | undefined;
}

/** Keep the catalogue upload number separate from an author's shard version. */
export function uploadIdentity({uploadNumber, revision, shardVersion, version}: WireUploadIdentity): UploadIdentity {
  const number = uploadNumber ?? revision;
  if (number === undefined || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid catalogue uploadNumber');
  const semver = shardVersion ?? version;
  return {uploadNumber: number, ...(semver === undefined ? {} : {shardVersion: semver})};
}

export function catalogueUpload<T extends WireUploadIdentity>(head: T): Omit<T, keyof WireUploadIdentity> & UploadIdentity {
  const normalized = uploadIdentity(head);
  if (head.uploadNumber === normalized.uploadNumber && !('revision' in head) && !('version' in head)) {
    return {...head, uploadNumber: normalized.uploadNumber};
  }
  const {uploadNumber: _number, revision: _revision, shardVersion: _shardVersion, version: _version, ...row} = head;
  return {...row, ...normalized};
}

/** Catalogue documents retain their placement and grid data during wire normalization. */
export function catalogueDocumentWithUploads(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('shards' in value) || !Array.isArray(value.shards)) throw new Error('Invalid catalogue document');
  return {...value, shards: (value.shards as WireUploadIdentity[]).map(catalogueUpload)};
}
