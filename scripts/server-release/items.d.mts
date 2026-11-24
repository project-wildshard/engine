import type { S3Client } from '@aws-sdk/client-s3';
import type { ReleaseFile } from '../../src/shared/host/releaseRows';

type ItemReference = NonNullable<ReleaseFile['items']>;
export function itemDigest(body: Uint8Array): string;
export function itemBytesMatch(body: Uint8Array, reference: ItemReference): boolean;
export function fetchItemCatalogue(read?: typeof fetch): Promise<Uint8Array>;
export function copyItemCatalogue(client: S3Client, bucket: string, read?: typeof fetch): Promise<ItemReference>;
