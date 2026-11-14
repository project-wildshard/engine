import { expect, test } from 'vitest';
import { isJsonData, isJsonDataWithFileSchemas } from '@wildshard/format/json';
import { nameBlob } from '../src/sharddev/blobs';
import {validateDefinedJson} from '../src/sharddev/sections';
import {encodeCanonicalJson} from '../src/shared/host/immutable';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema, validateNamedJsonSchemaPaced } from '../src/shared/game/shardfile/customSchema';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '@wildshard/engine/host/author';

const jsonSchema = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', maxItems: 20000,
  items: { type: 'array', minItems: 10, maxItems: 10, items: { type: 'number' } } };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('named JSON retains its byte-bound contract above the custom-section node cap', () => {
  const value = Array.from({ length: 12000 }, () => Array.from({ length: 10 }, () => 1));
  expect(isJsonData(value)).toBe(false);
  const schemaBytes=new TextEncoder().encode(encodeCanonicalJson(jsonSchema));
  expect(validateDefinedJson(schemaBytes,encode(value))).toEqual(value);
  expect(validateNamedJsonSchema(jsonSchema,encode(value))).toEqual(value);
  // A producer can name a temporary document; final output admission, not
  // this in-memory byte helper, enforces its registered shipping identity.
  const transient=nameBlob('data/placements.json','json',encode(value),{jsonSchema});
  expect(transient.bytes).toEqual(encode(value));
  value[9000] = [1];
  expect(() => validateDefinedJson(schemaBytes,encode(value))).toThrow('refuses its schema');
  expect(() => validateNamedJsonSchema(jsonSchema, encode(value))).toThrow('refuses its schema');
  expect(() => validateNamedJsonSchema(jsonSchema, new TextEncoder().encode('[[-0]]'))).toThrow('canonical numbers');
});

test('a paced named read pauses between its steps and compiles each schema once', async () => {
  const schema = { ...jsonSchema, maxItems: 4321 }, value = [Array.from({ length: 10 }, (_, i) => i)];
  let pauses = 0;
  const pause = () => { pauses++; return Promise.resolve(); };
  expect(await validateNamedJsonSchemaPaced(schema, encode(value), pause)).toEqual(value);
  expect(pauses).toBe(4); // parse | setup | compile | validate
  pauses = 0;
  expect(await validateNamedJsonSchemaPaced({ ...schema }, encode(value), pause)).toEqual(value);
  expect(pauses).toBe(2); // the same schema text reuses its compiled validator
  expect(validateNamedJsonSchema(schema, encode(value))).toEqual(value);
  await expect(validateNamedJsonSchemaPaced(schema, encode([[1]]), pause)).rejects.toThrow('refuses its schema');
  await expect(validateNamedJsonSchemaPaced(schema, new TextEncoder().encode('[[-0]]'), pause)).rejects.toThrow('canonical numbers');
  await expect(validateNamedJsonSchemaPaced({ ...schema, $schema: 'x' }, encode(value), pause)).rejects.toThrow('bounded draft-07');
  await expect(validateNamedJsonSchemaPaced(schema, encode(value), () => Promise.reject(new Error('Owner disposed')))).rejects.toThrow('Owner disposed');
});

test('each inline schema keeps the existing independent plain-JSON cap', () => {
  const schema = { ...jsonSchema, description: Array.from({ length: 60000 }, () => 'schema') };
  const index = { files: [{ jsonSchema: schema }, { jsonSchema: schema }] };
  expect(isJsonData(index)).toBe(false);
  expect(isJsonDataWithFileSchemas(index)).toBe(true);
  expect(isJsonDataWithFileSchemas({ files: [{ jsonSchema: { ...schema, extra: schema } }] })).toBe(false);
  const accessor = { files: [{ get jsonSchema() { throw new Error('Getter must not run'); } }] };
  expect(isJsonDataWithFileSchemas(accessor)).toBe(false);
});

test("a first-party build's named JSON parses without its schema; an external product's validates", async () => {
  const schema=registeredJsonSchema('models/shape-book.json'),good=[{slot:'shape',channels:[],file:'shape.glb'}],bad=[{slot:'shape'}];
  const identity = { slug: 'named-built', name: 'Named built', author: 'Wildshard', revision: 1, seed: 1 };
  const product = (value: unknown, builtJson: boolean) => createShardFolder({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity),
    sections: new Map(), files: new Map([['models/shape-book.json', { hash: 'a'.repeat(64), url: 'https://example.test/rows', jsonSchema: schema }]]),
    read: () => Promise.resolve(encode(value)), builtJson });
  // the build refuses malformed rows before they reach a product
  expect(() => nameBlob('models/shape-book.json', 'json', encode(bad), { jsonSchema: schema })).toThrow('refuses its schema');
  expect(await product(good, true).json('models/shape-book.json')).toEqual(good);
  expect(await product(good, false).json('models/shape-book.json')).toEqual(good);
  await expect(product(bad, false).json('models/shape-book.json')).rejects.toThrow('refuses its schema');
  // a built read still refuses bytes that are not canonical JSON
  await expect(createShardFolder({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
    files: new Map([['models/shape-book.json', { hash: 'a'.repeat(64), url: 'https://example.test/rows', jsonSchema: schema }]]),
    read: () => Promise.resolve(new TextEncoder().encode('[[-0]]')), builtJson: true }).json('models/shape-book.json')).rejects.toThrow('canonical numbers');
});
