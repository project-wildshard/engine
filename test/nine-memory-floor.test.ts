// oxlint-disable-next-line import/no-nodejs-modules -- the built product's verified bytes are read from its output folder
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { playLibrarySource, scopedSpecimenLibrarySource, tierLibrarySource, urlImageLibrarySource } from '../src/client/game/shardfile/productCost';
import { textureLibrarySource } from '@wildshard/format/deviceMemoryCost';
import { nearbyContentCost } from '@wildshard/format/budget';
import { builtProduct } from './fixtures/builtProduct';

/** D122: Nine Dragon's spawn, phone tier, read on HEAD preview a423f4d305 (Chromium, 2026-10-27): labelled GPU 245.6 MB +
 *  labelled RAM 287.1 MB. The admission's estimate there may shed what is never resident, never fall below this. */
const MEASURED_SPAWN_RESIDENT = 245_600_000 + 287_100_000;

test('Nine\'s play estimate at spawn never falls below its measured resident memory', async () => {
  const folder = builtProduct('nine-dragon-stack'), product = await loadHeadlessProduct(folder), source = product.shardfile;
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) throw new Error('Nine product has no output descriptor');
  // the bytes the projections read, as the admission holds them: the JSON files, the library's textures and images
  const assets = new Map<string, Uint8Array>(), library = new Set(source.library);
  for (const file of descriptor.index.files) if (file.kind === 'json' || (library.has(file.hash) && (file.kind === 'ktx2' || file.kind === 'image'))) assets.set(file.hash, new Uint8Array(readFileSync(`${folder}/${file.path}`)));
  // the same projections, in the same order, as the runtime admission (product.ts), on the phone tier with ASTC
  const tier = tierLibrarySource(source, 'phone', assets), images = urlImageLibrarySource(tier, assets);
  const scoped = scopedSpecimenLibrarySource(images, assets, { tier: 'phone' }), play = playLibrarySource(scoped);
  const device = textureLibrarySource(play, assets, { astc: true, bc7: false });
  expect(play.budgets.library.resident).toBeLessThan(scoped.budgets.library.resident);
  const spawn = nearbyContentCost(device, source.spawn.x, source.spawn.z);
  expect(spawn.accounted).toBeGreaterThanOrEqual(MEASURED_SPAWN_RESIDENT);
}, 300_000);
