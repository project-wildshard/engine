import type { S3Client } from '@aws-sdk/client-s3';
import type { ReleaseFile } from '../../src/shared/host/releaseRows.ts';

export interface PublishOptions {
  client: S3Client;
  bucket: string;
  candidate: ReleaseFile;
  privateKey: string;
  publicKey: string;
  isAncestor: (older: string, newer: string) => boolean;
  /** Null when the candidate's packs are published; otherwise why the channel is held. */
  packsReady?: (release: ReleaseFile) => Promise<string | null>;
  /** Staging only: a named green build may move the channel back. */
  align?: boolean;
}
export function serverPacksReady(client: S3Client, bucket: string, release: ReleaseFile): Promise<string | null>;
export function publishChannel(options: PublishOptions): Promise<{
  status: string; release: ReleaseFile; signed: string; reason?: string;
}>;
