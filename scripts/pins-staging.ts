// Row 23: a reviewed staging snapshot, independent of production's live pointers.
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {catalogueSlugs, documentSlugs, unlistedMessage, unlistedSlugs} from './pins-catalogue.ts';

interface Pin {slug: string; revision: number; hash: string; bytes: number}
interface Document {shards: Omit<Pin, 'bytes'>[]; missing: unknown[]; placements: {slug: string}[]; grid: {cells: {slug: string}[]}}
export interface StagingPins {version: 1; channel: 'staging'; api: string; catalogueHash: string; releaseHash: null; catalogue: Document; shards: Pin[]}
const file = 'test/pins/staging.json';
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function checkStaging(value: StagingPins): void {
  if (value.version !== 1 || value.channel !== 'staging' || value.releaseHash !== null || value.catalogueHash !== hash(value.catalogue)) throw new Error('Invalid staging snapshot identity');
  const {catalogue, shards} = value;
  if (!Array.isArray(catalogue.missing) || catalogue.missing.length !== 0 || !Array.isArray(shards) || shards.length === 0 || new Set(shards.map(row => row.slug)).size !== shards.length) throw new Error('Incomplete staging catalogue');
  if (shards.some(row => !/^[a-z0-9-]+$/u.test(row.slug) || !/^[a-f0-9]{64}$/u.test(row.hash) || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.bytes) || row.bytes <= 0)) throw new Error('Invalid staging pin');
  if (catalogue.shards.length !== shards.length || catalogue.shards.some(row => !shards.some(pin => pin.slug === row.slug && pin.hash === row.hash && pin.revision === row.revision))) throw new Error('Staging pins disagree with catalogue');
  const unlisted = unlistedSlugs(catalogueSlugs(catalogue), {staging: documentSlugs(catalogue)});
  if (unlisted.length > 0) throw new Error(unlistedMessage(unlisted));
}

export async function refreshStaging(api: string): Promise<void> {
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`${api}${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };
  const [document, listing] = await Promise.all([get('/api/catalogue.json?channel=staging'), get('/api/shardfiles')]);
  const catalogue = document as Document;
  const sizes = new Map((listing as {shardfiles: {hash: string; bytes: number}[]}).shardfiles.map(row => [row.hash, row.bytes]));
  const snapshot: StagingPins = {version: 1, channel: 'staging', api, catalogueHash: hash(catalogue),
    // AP-26 has no public release identity yet. Never call a catalogue digest a release hash.
    releaseHash: null, catalogue, shards: catalogue.shards.map(row => ({slug: row.slug, revision: row.revision, hash: row.hash, bytes: sizes.get(row.hash) ?? 0}))};
  checkStaging(snapshot);
  mkdirSync('test/pins', {recursive: true});
  writeFileSync(file, json(snapshot));
  console.log(`Pinned ${snapshot.shards.length} staging heads; release-hash verification waits on api-server AP-26`);
}

/** Materialize only in an explicitly selected test checkout; installers and both rings keep one input path. */
export function selectStaging(): void {
  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as StagingPins;
  checkStaging(snapshot);
  writeFileSync('test/pins/shardfiles.json', json({api: snapshot.api, shards: snapshot.shards}));
  writeFileSync('test/pins/catalogue.json', json(snapshot.catalogue));
  console.log(`Selected staging catalogue ${snapshot.catalogueHash}; release hash is unverified (AP-26)`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'select') selectStaging();
  else throw new Error('Use pins.ts refresh --channel staging, or pins-staging.ts select in a disposable test checkout');
}
