// @vitest-environment happy-dom
// SHARD-SOURCE S12f2b4: a phone prefetching a neighbouring cell reads what its entry will read. Since S12f2b2 a phone drawing
// the phone set reads a splat layer the cook encoded 6x6 from the cooked file, never its blob, so the grid's prefetch selection
// leaves that blob out too: it reads the neighbour's phone table (its discovery document) for the cooked rows.
import { afterEach, expect, test, vi } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { cookedSplatLayers } from '@wildshard/format/wholeInputs';
import { splatLayerKey } from '../src/shared/engine/boot/splatLayerRows';

const hex = (c: string): string => c.repeat(64);
const layers = (a: string, b: string) => ({ colour: [a, b, a, b].map(hex), normal: [a, b, a, b].map(hex), arm: [a, b, a, b].map(hex) });
const tint = [1, 1, 1];
// Pine after S12f2b3: the phone set's colour and normal are the desktop layers' own files; layer a has a cooked row, b none
const props = { splat: { material: 'ground', layers: layers('a', 'b'), phone: layers('a', 'b'), tints: [tint, tint, tint, tint], boreal: null } };
const file = (c: string) => ({ path: `blobs/ktx2/${hex(c)}.ktx2`, hash: hex(c), compressed: 10 });
const index = { format: 'wildshard.shardfile', formatVersion: 2, sections: [], schemas: [], files: [file('a'), file('b'), file('e')], runtime: null };
const source = { props, files: index.files } as unknown as Shardfile;
const cooked = `/assets/pine-hollow/splat/${hex('a')}.t16384-0123abcd.ktx2`;
const phoneTable = { [splatLayerKey(`/shardfiles/pine-hollow/blobs/ktx2/${hex('a')}.ktx2`)]: cooked, '/assets/tex/x.webp#layer': '/assets/gpu/x-11111111.ktx2' };

vi.mock('../src/shared/game/shardfile/outputDescriptor', async importOriginal => ({
  ...await importOriginal<typeof import('../src/shared/game/shardfile/outputDescriptor')>(),
  resolveOutputDescriptor: () => Promise.resolve(source),
  isBuildValidatedOutput: () => true,
}));
// The selection's descriptor walk needs a built product; this keeps its splat half, which is what the prefetch must feed.
vi.mock('../src/client/game/shardfile/folderCost', () => ({
  tierFolderFilesPaced: (from: Shardfile, tier: 'phone' | 'desktop', _pause: unknown, splatTier: () => 'phone' | 'desktop' = () => tier,
    splatLayer?: (hash: string) => string | undefined) => {
    const skipped = cookedSplatLayers(from, splatTier, splatLayer);
    return Promise.resolve(from.files.filter(row => !skipped.has(row.hash)));
  },
}));

afterEach(() => { vi.unstubAllGlobals(); });
const indexHash = hex('f'), url = `http://localhost/shardfiles/pine-hollow/shard.json?v=${indexHash.slice(0, 8)}`;
const read = (): Promise<Uint8Array> => Promise.resolve(new TextEncoder().encode(JSON.stringify(index)));

test('a phone\'s prefetch leaves out a splat layer blob its neighbour\'s phone table cooked', async () => {
  const { preparePrefetchIndex } = await import('../src/client/game/grid/prefetchIndexCore');
  const { phoneSplatLayers } = await import('../src/client/game/grid/prefetchSplatLayers');
  const splatLayers = phoneSplatLayers({ version: 1, slug: 'pine-hollow', rows: {}, native: { ktx2: { $call: 'pageModeKtx2', args: [{ shard: { phone: phoneTable, desktop: {} }, grid: { phone: phoneTable, desktop: {} } }] } } });
  expect(splatLayers).toEqual({ [hex('a')]: cooked });
  if (splatLayers === undefined) throw new Error('No cooked rows');
  const phone = await preparePrefetchIndex({ url, indexHashes: [indexHash], phone: true, splatLayers }, undefined, read);
  expect(phone?.files.map(row => row.hash)).toEqual([hex('b'), hex('e')]);
});

test('without a cooked row (an older cook), or on a desktop, the blob is prefetched as before', async () => {
  const { preparePrefetchIndex } = await import('../src/client/game/grid/prefetchIndexCore');
  const { phoneSplatLayers } = await import('../src/client/game/grid/prefetchSplatLayers');
  expect(phoneSplatLayers({ version: 1, slug: 'pine-hollow', rows: {}, native: {} })).toBeUndefined();
  expect(phoneSplatLayers('not a document')).toBeUndefined();
  const older = await preparePrefetchIndex({ url, indexHashes: [indexHash], phone: true }, undefined, read);
  expect(older?.files.map(row => row.hash)).toEqual([hex('a'), hex('b'), hex('e')]);
  const desktop = await preparePrefetchIndex({ url, indexHashes: [indexHash], phone: false, splatLayers: { [hex('a')]: cooked } }, undefined, read);
  expect(desktop?.files.map(row => row.hash)).toEqual([hex('a'), hex('b'), hex('e')]);
});
