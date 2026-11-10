import { expect, test } from 'vitest';
import { fixtureProductFile, fixtureJsonCheck } from './fixtures/productFile';
import { registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { createShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';
import { emptyShardfile } from '@wildshard/engine/host/author';

test('positive product fixtures retain declared identity and use the real registered schema', () => {
  const file = { hash: 'a'.repeat(64), url: '/original' };
  for (const name of ['quests/services.json', 'people/catalogue.json', 'world/placements/arch.json']) {
    expect(fixtureProductFile(name, file)).toEqual({ ...file, jsonSchema: registeredJsonSchema(name) });
    expect(file).toEqual({ hash: 'a'.repeat(64), url: '/original' });
  }
});

test('fixture schema filling preserves deliberate corruption and unrelated file identity', () => {
  const wrong = { hash: 'a'.repeat(64), url: '/original', jsonSchema: { type: 'null' } };
  expect(fixtureProductFile('quests/services.json', wrong)).toBe(wrong);
  const binary = { hash: 'b'.repeat(64), url: '/original.bin' };
  expect(fixtureProductFile('models/original.glb', binary)).toBe(binary);
});

test('a page fixture reads the real registered document through unchanged admission', async () => {
  const identity = { slug: 'fixture-metadata', name: 'Fixture', author: 'Test', revision: 1, seed: 1 };
  const rows = { version: 1, actions: [] }, bytes = new TextEncoder().encode(JSON.stringify(rows));
  const product = createShardProduct({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(), jsonCheck: fixtureJsonCheck,
    files: new Map([['quests/services.json', fixtureProductFile('quests/services.json', { hash: 'a'.repeat(64), url: 'original' })]]),
    read: () => Promise.resolve(bytes) });
  expect(await product.json('quests/services.json')).toEqual(rows);
  expect(bytes).toEqual(new TextEncoder().encode(JSON.stringify(rows)));
});
