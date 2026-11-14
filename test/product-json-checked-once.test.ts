import { expect, test } from 'vitest';
import { REGISTERED_JSON } from '@wildshard/format/registeredJson';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder, type ShardFolderInput } from '@wildshard/engine/game/shardfile/shardFolder';

// TEST-SPEED TS4: a product skips its platform and registered checks only for a name and hash that already passed
// with a pure decoder. A checker not marked pure, and any refusal, are checked on every read.
const name = 'quests/services.json';
const good = { version: 1, actions: [{ id: 'hello', effects: [{ kind: 'toast', text: 'Hello' }] }] };
const duplicate = { version: 1, actions: [...good.actions, ...good.actions] };
const schema = { $schema: 'http://json-schema.org/draft-07/schema#', $comment: REGISTERED_JSON[name].source, type: 'object' };
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const identity = { slug: 'checked-once', name: 'Checked once', author: 'Test', revision: 1, seed: 1 };
function input(value: unknown, read?: () => Promise<Uint8Array>): ShardFolderInput {
  return { slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
    files: new Map([[name, { hash: 'a'.repeat(64), url: 'https://example.test/data', jsonSchema: schema }]]),
    read: read ?? ((): Promise<Uint8Array> => Promise.resolve(encode(value))) };
}

test('a checker not marked pure is checked on every read', async () => {
  let call = 0;
  const product = createShardFolder({ ...input(good), jsonCheck: () => Promise.resolve(structuredClone(call++ === 0 ? good : duplicate)) });
  expect(await product.json(name)).toEqual(good);
  await expect(product.json(name)).rejects.toThrow('must be unique');
});

test('a pure read that passed still reads and decodes fresh values, and a refusal is never remembered', async () => {
  let reads = 0;
  const product = createShardFolder(input(good, () => { reads++; return Promise.resolve(encode(good)); }));
  const first = await product.json(name), second = await product.json(name);
  expect(second).toEqual(first); expect(second).not.toBe(first); expect(reads).toBe(2);
  const refusing = createShardFolder(input(duplicate));
  await expect(refusing.json(name)).rejects.toThrow('must be unique');
  await expect(refusing.json(name)).rejects.toThrow('must be unique');
});
