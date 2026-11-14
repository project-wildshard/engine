import { expect, test } from 'vitest';
import { REGISTERED_JSON, isRegisteredJsonName, validateRegisteredJson, type RegisteredJsonName } from '@wildshard/format/registeredJson';
import { QuestServiceActionsSchema } from '@wildshard/format/questSteps';
import { registeredJsonSchema, namedJsonSchema, namedFormatJsonSchemas } from '@wildshard/engine/host/formatJsonSchema';
import { encodeCanonicalJson } from '@wildshard/engine/host/immutable';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { validateDefinedJson } from '@wildshard/sharddev/sections';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder, type ShardFolderInput } from '@wildshard/engine/game/shardfile/shardFolder';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const name = 'quests/services.json';
const good = { version: 1, actions: [{ id: 'hello', effects: [{ kind: 'toast', text: 'Hello' }] }] };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const identity = { slug: 'registered-test', name: 'Registered test', author: 'Test', revision: 1, seed: 1 };
function input(value: unknown, schema: Readonly<Record<string, unknown>> | undefined = registeredJsonSchema(name)): ShardFolderInput {
  return { slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
    files: new Map([[name, { hash: 'a'.repeat(64), url: 'https://example.test/data', ...(schema === undefined ? {} : { jsonSchema: schema }) }]]),
    read: () => Promise.resolve(encode(value)) };
}

test('registered names use exact defining format schemas without changing the old schema document', () => {
  const catalogue = namedFormatJsonSchemas();
  for (const key of Object.keys(REGISTERED_JSON)) {
    expect(isRegisteredJsonName(key)).toBe(true);
    if (!isRegisteredJsonName(key)) throw new Error('Missing registered name');
    const schema = registeredJsonSchema(key), contract = REGISTERED_JSON[key];
    expect(schema).toEqual(catalogue[contract.source]);
    expect(schema).toEqual({ ...namedJsonSchema(contract.schema), $comment: contract.source });
  }
  expect(registeredJsonSchema(name)).toEqual({ ...namedJsonSchema(QuestServiceActionsSchema), $comment: REGISTERED_JSON[name].source });
  for (const key of ['quests/services', 'quests/services.json/other', 'private/services.json', '__proto__']) {
    expect(isRegisteredJsonName(key)).toBe(false);
    expect(registeredJsonSchema(key)).toBeUndefined();
  }
});

test('defining validation preserves the owned value and original semantic refusals', () => {
  const value = structuredClone(good), before = encode(value);
  Object.freeze(value.actions[0]?.effects); Object.freeze(value.actions[0]); Object.freeze(value.actions); Object.freeze(value);
  validateRegisteredJson(name, value);
  expect(encode(value)).toEqual(before);
  expect(() => validateRegisteredJson(name, { ...good, actions: [...good.actions, ...good.actions] })).toThrow('must be unique');
  expect(() => validateRegisteredJson('quests/achievements.json', {})).toThrow();
  expect(() => validateRegisteredJson('quests/page-composition.json', {})).toThrow();
  for (const key of ['people/catalogue.json', 'quests/chapter-director.json', 'quests/story.json', 'quests/stall.json'] as const)
    expect(() => validateRegisteredJson(key, [])).toThrow();
});

test('a registered read refuses missing or foreign metadata before reading any bytes', async () => {
  for (const schema of [undefined, {}, { $comment: '@wildshard/format/other#Schema' }]) {
    let reads = 0;
    const base = input(good);
    const product = createShardFolder({ ...base, files: new Map([[name, { hash: 'a'.repeat(64), url: 'x', ...(schema === undefined ? {} : { jsonSchema: schema }) }]]),
      read: () => { reads++; return Promise.resolve(encode(good)); }, builtJson: true });
    await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');
    expect(reads).toBe(0);
  }
});

test('external reads retain schema admission, defining semantic checks, identity and optional freezing', async () => {
  const schema = registeredJsonSchema(name), decoded = structuredClone(good);
  let checks = 0;
  const product = createShardFolder({ ...input(good, schema), check: true, jsonCheck: (actualSchema, bytes) => {
    checks++; expect(actualSchema).toBe(schema); expect(validateNamedJsonSchema(actualSchema, bytes)).toEqual(good);
    return Promise.resolve(decoded);
  } });
  const rows = await product.json(name);
  expect(rows).toBe(decoded); expect(rows.actions[0]?.id).toBe('hello'); expect(checks).toBe(1);
  expect(Object.isFrozen(rows.actions)).toBe(true);
  const permissive = { $schema: 'http://json-schema.org/draft-07/schema#', $comment: REGISTERED_JSON[name].source, type: 'object' };
  await expect(createShardFolder(input({ version: 1, actions: [...good.actions, ...good.actions] }, permissive)).json(name)).rejects.toThrow('must be unique');
  await expect(createShardFolder(input({ version: 9 }, permissive)).json(name)).rejects.toThrow('defining contract');
  await expect(createShardFolder(input({ version: 9 })).json(name)).rejects.toThrow('refuses its schema');
});

test('trusted built reads keep canonical parsing and do not invoke the external checker', async () => {
  const product = createShardFolder({ ...input(good), builtJson: true, jsonCheck: () => Promise.reject(new Error('Unexpected external check')) });
  expect(await product.json(name)).toEqual(good);
  await expect(createShardFolder({ ...input(good), builtJson: true,
    read: () => Promise.resolve(new TextEncoder().encode('{"version":-0}')) }).json(name)).rejects.toThrow('canonical numbers');
});

test('retired private documents refuse their old checked bridge and keep missing-file refusal', async () => {
  const privateName = 'private/data.json', base = input(good);
  const product = createShardFolder({ ...base, files: new Map([[privateName, { hash: 'a'.repeat(64), url: 'x', jsonSchema: namedJsonSchema(QuestServiceActionsSchema) }]]) });
  await expect(product.json(privateName)).rejects.toThrow('unregistered named JSON is retired');
  await expect(product.json('absent.json')).rejects.toThrow('names no file');
  const keys: readonly RegisteredJsonName[] = ['quests/achievements.json', 'quests/page-composition.json', name];
  expect(keys).toHaveLength(3);
});


test('author and independent output admission enforce the registered semantic contract', () => {
  const schema = registeredJsonSchema(name), bytes = encode(good), before = bytes.slice();
  const blob = nameBlob(name, 'json', bytes, { jsonSchema: schema });
  expect(blob.bytes).toEqual(before); expect(bytes).toEqual(before);
  expect(() => nameBlob(name, 'json', bytes)).toThrow('requires its defining schema');
  expect(() => nameBlob(name, 'bin', bytes, { jsonSchema: schema })).toThrow('requires its defining schema');
  expect(() => nameBlob(name, 'json', bytes, { jsonSchema: namedJsonSchema(QuestServiceActionsSchema) })).toThrow('exact defining format contract');
  const permissive = { $schema: 'http://json-schema.org/draft-07/schema#', $comment: REGISTERED_JSON[name].source, type: 'object' };
  expect(() => nameBlob(name, 'json', bytes, { jsonSchema: permissive })).toThrow('exact defining format contract');
  const duplicate = encode({ ...good, actions: [...good.actions, ...good.actions] });
  expect(() => nameBlob(name, 'json', duplicate, { jsonSchema: schema })).toThrow('must be unique');
  expect(() => validateDefinedJson(new TextEncoder().encode(encodeCanonicalJson(schema)), duplicate, name)).toThrow('must be unique');
  expect(() => validateDefinedJson(new TextEncoder().encode(encodeCanonicalJson(schema)), encode({ version: 9 }), name)).toThrow('refuses its schema');
});
