import { expect, test } from 'vitest';
import { registeredJsonContract, validateRegisteredJson, type RegisteredPlacementJsonName } from '@wildshard/format/registeredJson';
import { WorldScenePlacementSchema, parseWorldScenePlacement } from '@wildshard/format/worldScenePlacement';
import { registeredJsonSchema, namedJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';

const names: readonly RegisteredPlacementJsonName[] = ['world/placements/arch.rim.json', 'scenes/placements/roof.one.json', 'world/foliage/reeds-phone.json', 'world/piers/deck-2.json'];
const row = { id: 'arch', model: 'arch', draw: 'instanced', poses: [{ x: 1, y: 2, z: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1], color: [0.3, 0.6, 0.9] }],
  cull: { bounds: 'box', frustum: true }, drawnInto: { part: 'arch', boxes: [0, 0, 0, 1, 1, 1] } };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const identity = { slug: 'placement-contract', name: 'Placement', author: 'Test', revision: 1, seed: 1 };

test('all placement namespaces bind the same original format object and provenance', () => {
  for (const name of names) {
    expect(registeredJsonContract(name).schema).toBe(WorldScenePlacementSchema);
    expect(registeredJsonSchema(name)).toEqual({ ...namedJsonSchema(WorldScenePlacementSchema),
      $comment: '@wildshard/format/worldScenePlacement#WorldScenePlacementSchema' });
  }
  for (const name of ['world/placements/.json', 'world/piers/a/b.json', 'world/foliage/../bad.json', `scenes/placements/${'a'.repeat(181)}.json`])
    expect(() => registeredJsonContract(name)).toThrow('bounded platform id');
  expect(registeredJsonContract('world/placements/arch.bin')).toBeUndefined();
  expect(registeredJsonContract('private/placements/arch.json')).toBeUndefined();
});

test('registered author admission preserves every payload byte, draw and cull value', () => {
  const before = encode(row);
  for (const name of names) {
    const value = structuredClone(row);
    validateRegisteredJson(name, value);
    expect(encode(value)).toEqual(before);
    const blob = nameBlob(name, 'json', before, { jsonSchema: registeredJsonSchema(name) });
    expect(blob.bytes).toEqual(before);
    expect(JSON.parse(new TextDecoder().decode(blob.bytes))).toEqual(row);
  }
});

test('the original cross-field and reference-shape checks survive structural schema admission', () => {
  const name = names[0]; if (name === undefined) throw new Error('Missing fixture');
  const bad = { ...row, drawnInto: { part: 'arch', boxes: [0] } };
  expect(() => parseWorldScenePlacement(bad)).toThrow();
  expect(() => nameBlob(name, 'json', encode(bad), { jsonSchema: registeredJsonSchema(name) })).toThrow();
  expect(() => nameBlob(name, 'json', encode(row))).toThrow('defining schema');
  expect(() => nameBlob(name, 'json', encode(row), { jsonSchema: namedJsonSchema(WorldScenePlacementSchema) })).toThrow('exact defining format contract');
});

test('checked and trusted reads retain original decoded placement values', async () => {
  for (const builtJson of [false, true]) {
    const name = 'world/placement-pages/arch.json', page = { version: 1, rows: [row] };
    const bytes = encode(page), product = createShardProduct({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity),
      sections: new Map(), files: new Map([[name, { hash: 'a'.repeat(64), url: 'x', jsonSchema: registeredJsonSchema(name) }]]),
      read: () => Promise.resolve(bytes), builtJson, check: true });
    const value = await product.json(name);
    expect(value).toEqual(page);
    expect(Object.isFrozen(value)).toBe(true);
    expect(bytes).toEqual(encode(page));
  }
});

test('a family read refuses missing provenance before its asset reader runs', async () => {
  let reads = 0;
  const name = 'world/placements/arch.json', product = createShardProduct({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity),
    sections: new Map(), files: new Map([[name, { hash: 'a'.repeat(64), url: 'x', jsonSchema: namedJsonSchema(WorldScenePlacementSchema) }]]),
    read: () => { reads++; return Promise.resolve(encode(row)); }, builtJson: true });
  await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');
  expect(reads).toBe(0);
});
