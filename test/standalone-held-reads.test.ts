// oxlint-disable-next-line import/no-nodejs-modules -- The worker's reader runs on a built product's bytes.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { validationSourceBytes } from '@wildshard/format/validationReceipt';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { contentHash } from '../src/shared/game/shardfile/contentHash';
import { isBuildValidatedOutput } from '../src/shared/game/shardfile/outputDescriptor';
import { answerHeldReads, askHeldReads } from '../src/shared/host/standalone/heldReads';
import { fetchServerProduct } from '../src/server/host/standalone/serverProduct';
import { builtProduct } from './fixtures/builtProduct';

test('a held read crosses the port, and a miss or a failed read is a null', async () => {
  const { port1, port2 } = new MessageChannel();
  answerHeldReads(port1, url => url === 'held' ? Promise.resolve(Uint8Array.of(1, 2).buffer) : url === 'broken' ? Promise.reject(new Error('refused')) : Promise.resolve(null));
  const ask = askHeldReads(port2);
  expect([...new Uint8Array(await ask('held') ?? new ArrayBuffer(0))]).toEqual([1, 2]);
  expect(await ask('elsewhere')).toBeNull();
  expect(await ask('broken')).toBeNull();
  port1.close();
});

test('a product the page holds moves nothing over the network', async () => {
  const directory = builtProduct('sunscar-dunes'), root = 'https://held.test/shardfiles/sunscar-dunes/';
  const network = vi.fn(() => Promise.reject(new Error('the network was read')));
  const page = { location: Reflect.get(globalThis, 'location'), fetch: globalThis.fetch };
  Reflect.set(globalThis, 'location', { href: 'https://held.test/b/test/standalone/serverWorker.js' }); Reflect.set(globalThis, 'fetch', network);
  const asked: string[] = [];
  const held = (url: string): Promise<ArrayBuffer | null> => {
    asked.push(url);
    const path = url.startsWith(root) ? url.slice(root.length) : null;
    return Promise.resolve(path === null ? null : Uint8Array.from(readFileSync(`${directory}/${path}`)).buffer);
  };
  const input = await fetchServerProduct(root, await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), held)
    .finally(() => { Reflect.set(globalThis, 'location', page.location); Reflect.set(globalThis, 'fetch', page.fetch); });
  expect(input.shard.identity.slug).toBe('sunscar-dunes');
  expect(asked[0]).toBe(`${root}shard.json`);
  expect(network).not.toHaveBeenCalled();
});

test('a worker told its build\'s verdict reads that build\'s product unchecked, and any other product checked', async () => {
  const directory = builtProduct('sunscar-dunes'), root = 'https://held.test/shardfiles/sunscar-dunes/', index = parseOutputIndex(JSON.parse(readFileSync(`${directory}/shard.json`, 'utf8')));
  const page = { location: Reflect.get(globalThis, 'location'), fetch: globalThis.fetch }, rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const held = (url: string): Promise<ArrayBuffer> => Promise.resolve(Uint8Array.from(readFileSync(`${directory}/${url.slice(root.length)}`)).buffer);
  const verdict = { revision: 'a build', sourceHash: index.build.sourceHash, indexHash: await contentHash(validationSourceBytes(index)), worst: { playing: 0, loading: 0, accounted: 0, location: [0, 0] } };
  Reflect.set(globalThis, 'location', { href: 'https://held.test/b/test/standalone/serverWorker.js' }); Reflect.set(globalThis, 'fetch', () => Promise.reject(new Error('the network was read')));
  try {
    const checked = await fetchServerProduct(root, rapier, held);
    expect(isBuildValidatedOutput(checked.shard)).toBe(false);
    Object.assign(globalThis, { __SHARDFILE_VALIDATOR__: 'a build', __SHARDFILE_VERDICTS__: [verdict] });
    const built = await fetchServerProduct(root, rapier, held);
    expect(isBuildValidatedOutput(built.shard)).toBe(true);
    Object.assign(globalThis, { __SHARDFILE_VERDICTS__: [{ ...verdict, indexHash: 'e'.repeat(64) }] });
    expect(isBuildValidatedOutput((await fetchServerProduct(root, rapier, held)).shard)).toBe(false);
  } finally {
    for (const name of ['__SHARDFILE_VALIDATOR__', '__SHARDFILE_VERDICTS__']) Reflect.deleteProperty(globalThis, name);
    Reflect.set(globalThis, 'location', page.location); Reflect.set(globalThis, 'fetch', page.fetch);
  }
});
