import { expect, expectTypeOf, test } from 'vitest';
import { PackedCreatureLooksSchema, parsePackedCreatureLooks } from '@wildshard/format/speciesLooks';
import { registeredJsonContract, validateRegisteredJson } from '@wildshard/format/registeredJson';
import { namedJsonSchema, registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';

const names = ['look/creature-looks.json', 'actors/species-looks.json'] as const;
const raw = { poses: {}, rows: [] };
const bytes = () => new TextEncoder().encode(JSON.stringify(raw));

test('both existing look names bind one original schema and preserve authored bytes', () => {
  for (const name of names) {
    expect(registeredJsonContract(name).schema).toBe(PackedCreatureLooksSchema);
    expect(registeredJsonSchema(name)).toEqual({ ...namedJsonSchema(PackedCreatureLooksSchema),
      $comment: '@wildshard/format/speciesLooks#PackedCreatureLooksSchema' });
    const value = structuredClone(raw);
    validateRegisteredJson(name, value);
    expect(value).toEqual(raw); expect(Object.isFrozen(value)).toBe(false);
    expect(value).not.toHaveProperty('frames');
    expect(nameBlob(name, 'json', bytes(), { jsonSchema: registeredJsonSchema(name) }).bytes).toEqual(bytes());
  }
});

test('wire reads do not promise or insert defaults owned by the native consumer', async () => {
  const identity = { slug: 'looks-fixture', name: 'Looks', author: 'Test', revision: 1, seed: 1 };
  for (const name of names) for (const builtJson of [false, true]) {
    const product = createShardFolder({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
      files: new Map([[name, { hash: 'a'.repeat(64), url: '/original', jsonSchema: registeredJsonSchema(name) }]]),
      read: () => Promise.resolve(bytes()), builtJson });
    const value = await product.json(name);
    expectTypeOf(value).toBeUnknown();
    expect(value).toEqual(raw); expect(value).not.toHaveProperty('frames');
    expect(Object.isFrozen(value)).toBe(false);
    const parsed = parsePackedCreatureLooks(value);
    expect(parsed.frames).toEqual({}); expect(Object.isFrozen(parsed)).toBe(true);
    expect(value).toEqual(raw); expect(value).not.toHaveProperty('frames');
  }
});

test('invalid packed look rows and missing contracts still refuse', () => {
  for (const name of names) {
    expect(() => nameBlob(name, 'json', bytes())).toThrow('defining schema');
    const invalid = new TextEncoder().encode('{"poses":{},"rows":[],"unexpected":true}');
    expect(() => nameBlob(name, 'json', invalid, { jsonSchema: registeredJsonSchema(name) })).toThrow();
  }
});
