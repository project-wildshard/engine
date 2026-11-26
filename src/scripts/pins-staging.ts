// Row 23: a reviewed staging snapshot, independent of production's live pointers.
import {catalogueUpload, type WireUploadIdentity} from '../shared/game/grid/uploadIdentity.ts';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {catalogueSlugs, documentSlugs, unlistedMessage, unlistedSlugs} from './pins-catalogue.ts';

interface Pin {slug: string; uploadNumber: number; hash: string; bytes: number; shardVersion?: string | undefined}
interface Document {shards: Omit<Pin, 'bytes'>[]; missing: unknown[]; placements: {slug: string}[]; grid: {cells: {slug: string}[]}}
export interface StagingPins {version: 1; channel: 'staging'; api: string; catalogueHash: string; releaseHash: string; catalogue: Document; shards: Pin[]}
const file = 'test/pins/staging.json';
// api-server AP-26 (meta MACBOOK-WAITS MW1): the channel's release identity, the sha256 of the placement file body its row names.
export const RELEASE_HASH_HEADER = 'x-wildshard-release-hash';
const isReleaseHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function checkStaging(value: StagingPins): void {
  if (value.version !== 1 || value.channel !== 'staging' || !isReleaseHash(value.releaseHash) || value.catalogueHash !== hash(value.catalogue)) throw new Error('Invalid staging snapshot identity');
  const {catalogue, shards} = value;
  if (!Array.isArray(catalogue.missing) || catalogue.missing.length > 0 || !Array.isArray(shards) || shards.length === 0 || new Set(shards.map(row => row.slug)).size !== shards.length) throw new Error('Incomplete staging catalogue');
  if (shards.some(row => !/^[a-z0-9-]+$/u.test(row.slug) || !/^[a-f0-9]{64}$/u.test(row.hash) || !Number.isSafeInteger(row.uploadNumber) || row.uploadNumber < 1 || !Number.isSafeInteger(row.bytes) || row.bytes <= 0)) throw new Error('Invalid staging pin');
  if (catalogue.shards.length !== shards.length || catalogue.shards.some(row => !shards.some(pin => pin.slug === row.slug && pin.hash === row.hash && pin.uploadNumber === row.uploadNumber))) throw new Error('Staging pins disagree with catalogue');
  const unlisted = unlistedSlugs(catalogueSlugs(catalogue), {staging: documentSlugs(catalogue)});
  if (unlisted.length > 0) throw new Error(unlistedMessage(unlisted));
}

export async function refreshStaging(api: string): Promise<void> {
  const get = async (path: string): Promise<Response> => {
    const response = await fetch(`${api}${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const [document, shardfiles] = await Promise.all([get('/api/catalogue.json?channel=staging&wire=upload'), get('/api/shardfiles')]);
  const releaseHash = document.headers.get(RELEASE_HASH_HEADER);
  if (!isReleaseHash(releaseHash)) throw new Error(`/api/catalogue.json?channel=staging&wire=upload names no ${RELEASE_HASH_HEADER} (api-server AP-26)`);
  const [wire, listing] = [await document.json() as Omit<Document, 'shards'> & {shards: (WireUploadIdentity & {slug: string; hash: string})[]}, await shardfiles.json() as unknown];
  const catalogue = {...wire, shards: wire.shards.map(catalogueUpload)};
  const sizes = new Map((listing as {shardfiles: {hash: string; bytes: number}[]}).shardfiles.map(row => [row.hash, row.bytes]));
  const snapshot: StagingPins = {version: 1, channel: 'staging', api, catalogueHash: hash(catalogue),
    releaseHash, catalogue, shards: catalogue.shards.map(row => ({slug: row.slug, uploadNumber: row.uploadNumber, ...(row.shardVersion === undefined ? {} : {shardVersion: row.shardVersion}), hash: row.hash, bytes: sizes.get(row.hash) ?? 0}))};
  checkStaging(snapshot);
  mkdirSync('test/pins', {recursive: true});
  writeFileSync(file, json(snapshot));
  console.log(`Pinned ${snapshot.shards.length} staging heads at release ${releaseHash}`);
}

/** Read the reviewed staging heads without changing the normal checkout pins. */
export function readStaging(): StagingPins {
  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as StagingPins;
  checkStaging(snapshot);
  return snapshot;
}

/** The committed snapshot is the release staging serves: its release hash matches the live catalogue's. */
export async function verifyStaging(snapshot: StagingPins = readStaging()): Promise<void> {
  const response = await fetch(`${snapshot.api}/api/catalogue.json?channel=staging&wire=upload`, {cache: 'no-store'});
  if (!response.ok) throw new Error(`staging catalogue: HTTP ${response.status}`);
  const live = response.headers.get(RELEASE_HASH_HEADER);
  if (live !== snapshot.releaseHash) throw new Error(`staging release drifted: snapshot ${snapshot.releaseHash}, live ${live ?? 'none'}; run pins.ts refresh --channel staging`);
  console.log(`Staging snapshot matches live release ${live}`);
}

/** Materialize only in an explicitly selected test checkout; installers and both rings keep one input path. */
export function selectStaging(): void {
  const snapshot = readStaging();
  writeFileSync('test/pins/shardfiles.json', json({api: snapshot.api, shards: snapshot.shards}));
  writeFileSync('test/pins/catalogue.json', json(snapshot.catalogue));
  console.log(`Selected staging catalogue ${snapshot.catalogueHash} at release ${snapshot.releaseHash}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'select') selectStaging();
  else if (process.argv[2] === 'verify') await verifyStaging();
  else throw new Error('Use pins.ts refresh --channel staging, pins-staging.ts verify, or pins-staging.ts select in a disposable test checkout');
}
