import { expect, test } from 'vitest';
import { REGISTERED_JSON, validateRegisteredJson } from '@wildshard/format/registeredJson';
import { QuestPageInteractionsSchema, parseQuestPageInteractions } from '@wildshard/format/questInteractions';
import { registeredJsonSchema, namedJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { encodeCanonicalJson } from '@wildshard/engine/host/immutable';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';
import { fixtureJsonCheck } from './fixtures/folderFile';

const names = ['quests/trader.json', 'quests/mill-door.json', 'quests/lanterns.json'] as const;
const source = '@wildshard/format/questInteractions#QuestPageInteractionsSchema';
const good = { actions: [{ id: 'take', after: [{ kind: 'toast', text: 'Taken' }] }] };
const encode = (value: unknown) => new TextEncoder().encode(encodeCanonicalJson(value));
const identity = { slug: 'page-contract', name: 'Page contract', author: 'Test', revision: 1, seed: 1 };

test('all original page names use the shared native schema and preserve payload bytes', () => {
  const value = structuredClone(good), bytes = encode(value);
  for (const name of names) {
    expect(REGISTERED_JSON[name].schema).toBe(QuestPageInteractionsSchema);
    expect(REGISTERED_JSON[name].source).toBe(source);
    const schema = registeredJsonSchema(name);
    expect(schema).toEqual({ ...namedJsonSchema(QuestPageInteractionsSchema), $comment: source });
    expect(parseQuestPageInteractions(value)).toEqual(value);
    validateRegisteredJson(name, value);
    expect(nameBlob(name, 'json', bytes, { jsonSchema: schema }).bytes).toEqual(bytes);
    expect(encode(value)).toEqual(bytes);
  }
});

test('every name keeps native duplicate, unknown-field and unsafe-path refusals', () => {
  const bad = [
    { ...good, actions: [...good.actions, ...good.actions] },
    { ...good, extra: true },
    { ...good, bindings: { calls: [{ target: 'run', owner: 'world', path: ['constructor'] }] } },
  ];
  for (const name of names) {
    for (const value of bad) {
      expect(() => parseQuestPageInteractions(value)).toThrow();
      expect(() => validateRegisteredJson(name, value)).toThrow();
      expect(() => nameBlob(name, 'json', encode(value), { jsonSchema: registeredJsonSchema(name) })).toThrow();
    }
    expect(() => nameBlob(name, 'json', encode(good))).toThrow('requires its defining schema');
    expect(() => nameBlob(name, 'json', encode(good), { jsonSchema: namedJsonSchema(QuestPageInteractionsSchema) })).toThrow('exact defining format contract');
    expect(() => nameBlob(name, 'json', encode(good), { jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', $comment: source, type: 'object' } })).toThrow('exact defining format contract');
  }
});

test('missing or foreign metadata refuses before any registered payload read', async () => {
  for (const name of names) {
    for (const schema of [undefined, {}, { $comment: 'foreign' }]) {
      let reads = 0;
      const product = createShardFolder({
        slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
        files: new Map([[name, { hash: 'a'.repeat(64), url: 'https://example.test/page', ...(schema === undefined ? {} : { jsonSchema: schema }) }]]),
        read: () => { reads++; return Promise.resolve(encode(good)); }, builtJson: true,
      });
      await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');
      expect(reads).toBe(0);
    }
  }
});

test('built reads retain canonical parsing and external reads retain native semantics', async () => {
  for (const name of names) {
    const input = {
      slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
      files: new Map([[name, { hash: 'a'.repeat(64), url: 'https://example.test/page', jsonSchema: registeredJsonSchema(name) }]]),
      read: () => Promise.resolve(encode(good)), builtJson: true,
      jsonCheck: () => Promise.reject(new Error('Unexpected external checker')),
    };
    expect(await createShardFolder(input).json(name)).toEqual(good);
    await expect(createShardFolder({ ...input, builtJson: false, jsonCheck: fixtureJsonCheck,
      read: () => Promise.resolve(encode({ actions: [...good.actions, ...good.actions] })) }).json(name)).rejects.toThrow('unique page interaction ids');
    await expect(createShardFolder({ ...input, read: () => Promise.resolve(new TextEncoder().encode('{"actions":[],"bindings":{"calls":[{"target":"turn","owner":"world","path":["turn"],"args":[-0]}]}}')) }).json(name)).rejects.toThrow('canonical numbers');
  }
});
