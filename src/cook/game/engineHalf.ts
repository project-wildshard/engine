// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {readFileSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join} from 'node:path';
import {readSpawnManifest, type SpawnFile, type SpawnManifest, type SpawnManifestAddress} from '../../shared/game/shardfile/spawnManifest';
import type {SpawnManifestBook} from './entryTotals';

export interface EngineHalfBook {
  readonly book: 'engine';
  readonly build: string;
  readonly client: Readonly<Record<'phone' | 'desktop', SpawnManifestAddress>>;
  readonly grid: Readonly<Record<'phone' | 'desktop', SpawnManifestAddress>>;
}
export const engineHalfBookPath = (build: string): string => `assets/spawn/engine-${build}.json`;

/** What every shard's manifest of a tier and flow lists: the build's half, which no shard owns. */
export function sharedRows(manifests: readonly Pick<SpawnManifest, 'files'>[]): readonly SpawnFile[] {
  const [first, ...rest] = manifests;
  if (first === undefined) return [];
  const others = rest.map(row => new Set(row.files.map(file => file.url)));
  return first.files.filter(file => others.every(urls => urls.has(file.url)));
}

/** C1 (J83): the engine half of the split, one manifest per tier and flow. No page reads it yet: a shard's cook names only its
 *  own half, and a page that boots a cooked shard takes this one for the rest (C3). It is a file of its own, so today's
 *  manifests and every byte a phone downloads stay as they are. */
export function writeEngineHalves(outDir: string, book: Pick<SpawnManifestBook, 'client' | 'grid'>, build: string): EngineHalfBook {
  const read = (address: SpawnManifestAddress): SpawnManifest => readSpawnManifest(JSON.parse(readFileSync(join(outDir, address.url.slice(1)), 'utf8')));
  const half = (flow: 'client' | 'grid', tier: 'phone' | 'desktop', addresses: readonly SpawnManifestAddress[]): SpawnManifestAddress => {
    const files = sharedRows(addresses.map(read)), totalBytes = files.reduce((sum, row) => sum + row.bytes, 0), wireBytes = files.reduce((sum, row) => sum + (row.wireBytes ?? 0), 0);
    const text = JSON.stringify(readSpawnManifest({version: 1, shard: 'engine', tier, flow, files, totalBytes, wireBytes}));
    const url = `/assets/spawn/engine-${flow}-${tier}-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.json`;
    writeFileSync(join(outDir, url.slice(1)), text);
    return {url, bytes: Buffer.byteLength(text), totalBytes, files: files.length, wireBytes};
  };
  const homes = Object.values(book.client), modes = Object.values(book.grid['000'] ?? {});
  const flowOf = (flow: 'client' | 'grid', rows: typeof homes): EngineHalfBook['client'] => ({phone: half(flow, 'phone', rows.map(row => row.phone)), desktop: half(flow, 'desktop', rows.map(row => row.desktop))});
  return {book: 'engine', build, client: flowOf('client', homes), grid: flowOf('grid', modes)};
}
