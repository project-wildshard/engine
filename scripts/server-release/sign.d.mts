import type { ReleaseFile } from '../../src/shared/host/releaseRows.ts';

export const COMMIT: RegExp;
export function publication(value: unknown): ReleaseFile;
export function releasePublicKey(pem: string): string;
export function signRelease(value: unknown, pem: string): string;
export function readPublication(text: string, publicKey: string): ReleaseFile;
export function bundleDescriptor(archive: string, tag: string): { name: string; sha256: string };
export function servedSlug(slug: string): string;
export function releaseShards(pins: unknown, names: string): ReleaseFile['shards'];
