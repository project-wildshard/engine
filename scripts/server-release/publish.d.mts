import type { S3Client } from '@aws-sdk/client-s3';
import type { ReleaseFile } from '../../src/shared/host/releaseRows.ts';

export interface PublishOptions {
  client: S3Client;
  bucket: string;
  candidate: ReleaseFile;
  privateKey: string;
  publicKey: string;
  isAncestor: (older: string, newer: string) => boolean;
}
export function publishChannel(options: PublishOptions): Promise<{
  status: string; release: ReleaseFile; signed: string;
}>;
