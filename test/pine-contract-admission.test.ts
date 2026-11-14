import { expect, test } from 'vitest';
import { PINE as pine, PINE_PREPARED_OUTPUT as output } from './fixtures/pine-program';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import type { ContractCatalogue } from '@wildshard/format/contracts';

test('the actual contract file validates before page or native board construction', async () => {
  const file = output.namedFiles.find(row => row.name === 'quests/contracts.json');
  const bytes = file === undefined ? undefined : output.assets.get(file.hash);
  if (file === undefined || bytes === undefined || file.jsonSchema === undefined) throw new Error('The board needs its admitted named schema');
  const jsonSchema = file.jsonSchema;
  const read = (body: Uint8Array) => createShardFolder({ slug: 'pine-hollow', revision: 1, shardfile: pine, sections: new Map(),
    files: new Map([['quests/contracts.json', { hash: file.hash, url: file.path, jsonSchema }]]),
    read: () => Promise.resolve(body) }).json<ContractCatalogue>('quests/contracts.json');
  const catalogue = await read(bytes);
  expect(catalogue.rows).toHaveLength(11);
  expect(catalogue.program?.bytes).toBe('');
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  await expect(read(encode({ ...catalogue, slots: 0 }))).rejects.toThrow('refuses its schema');
  await expect(read(encode({ ...catalogue, tags: [{ tag: 'unbound', any: [{}] }] }))).rejects.toThrow('refuses its schema');
  await expect(read(encode({ ...catalogue, runtimeHook: 'foreign' }))).rejects.toThrow('refuses its schema');
});
