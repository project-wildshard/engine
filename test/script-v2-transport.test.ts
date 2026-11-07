// oxlint-disable-next-line import/no-nodejs-modules -- Browser admission reads exactly the sealed local product bytes.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve local immutable members of the chosen pin.
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { resolve } from 'node:path';
import { expect,test } from 'vitest';
import { admitProduct,readProductDescriptor,type ProductOptions } from '../src/client/game/shardfile/product';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { builtProduct,runtimeAssets } from './fixtures/engine-lift/product';

test('published ABI2 declarations survive disk, browser admission and native execution', async () => {
  const directory = builtProduct('driftwood-isle'), product = await loadHeadlessProduct(directory);
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing published output');
  const declarations = scriptAdmissionRows(descriptor.sections);
  expect(declarations.some(row => row.abi === 2)).toBe(true);
  const base = 'https://transport.test/';
  const options: ProductOptions = { base, offline: false, firstParty: true,
    hash: bytes => Promise.resolve(hashImmutableBytes(bytes)),
    fetch: url => Promise.resolve(new Response(Uint8Array.from(readFileSync(resolve(directory, new URL(url).pathname.slice(1)))))) };
  const source = await readProductDescriptor(options), browser = await admitProduct(source, options);
  expect(scriptAdmissionRows(outputDescriptor(source)?.sections ?? new Map())).toEqual(declarations);
  expect(browser.assets.size).toBeGreaterThan(0);
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const live = await createTrustedHeadlessResident({ shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier });
  try { live.step([]); expect(live.host.state.tick).toBe(1); } finally { live.dispose(); }
}, 10_000);

test('browser admission refuses a rewritten ABI2 page contract over the unchanged executable', async () => {
  const directory = builtProduct('driftwood-isle');
  const index = JSON.parse(readFileSync(resolve(directory, 'shard.json'), 'utf8')) as {
    sections: { name: string; path: string; bytes: number; hash: string }[];
    packs?: unknown;
  };
  const section = index.sections.find(row => row.name === 'view/modules');
  if (section === undefined) throw new Error('Missing admitted view declarations');
  const value = JSON.parse(readFileSync(resolve(directory, section.path), 'utf8')) as { abi: number; pages: number }[];
  const row = value.find(module => module.abi === 2);
  if (row === undefined) throw new Error('Missing ABI2 view declaration');
  row.pages++;
  const changed = new TextEncoder().encode(JSON.stringify(value));
  section.hash = hashImmutableBytes(changed); section.bytes = changed.length;
  delete index.packs;
  const options: ProductOptions = { base: 'https://transport.test/', offline: false, firstParty: true,
    hash: bytes => Promise.resolve(hashImmutableBytes(bytes)),
    fetch: url => {
      const name = new URL(url).pathname.slice(1);
      const bytes = name === 'shard.json' ? new TextEncoder().encode(JSON.stringify(index))
        : name === section.path ? changed : Uint8Array.from(readFileSync(resolve(directory, name)));
      return Promise.resolve(new Response(bytes));
    } };
  const load = async () => admitProduct(await readProductDescriptor(options), options);
  await expect(load()).rejects.toThrow(/fixed pages|script memory/u);
}, 10_000);
