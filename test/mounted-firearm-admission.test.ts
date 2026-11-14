import { expect, test } from 'vitest';
import { parseHeldFirearmRows, parseHeldFirearmView } from '@wildshard/format/weaponProfiles';
import { registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { fixtureJsonCheck } from './fixtures/folderFile';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import source from './fixtures/nalati-rifle-original.json' with { type: 'json' };

const encode = (input: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(input));
test('baked firearm admission preserves every feel and playback row and refuses invalid products', async () => {
  const schema = registeredJsonSchema('weapons/rifle-page.json'), bytes = encode(source);
  const blob = nameBlob('weapons/rifle-page.json', 'json', bytes, { jsonSchema: schema });
  const identity = { slug: 'firearm-admission', name: 'Firearm admission', author: 'Wildshard', revision: 1, seed: 1 };
  const product = (input: unknown) => createShardFolder({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(), jsonCheck: fixtureJsonCheck,
    files: new Map([['weapons/rifle-page.json', { ...blob.file, url: 'https://example.test/firearm' }]]), read: () => Promise.resolve(encode(input)) });
  const admitted = await product(source).json<typeof source>('weapons/rifle-page.json');
  expect(encode(admitted)).toEqual(bytes);
  expect(admitted.feel).toEqual(source.feel);
  expect(admitted.view).toEqual(parseHeldFirearmView(source.view));
  expect(admitted.rows).toEqual(parseHeldFirearmRows(source.rows));
  for (const input of [
    { ...source, feel: { ...source.feel, ads: { ...source.feel.ads, blend: 'slow' } } },
    { ...source, view: { ...source.view, flash: { ...source.view.flash, frames: 'two' } } },
    { ...source, rows: { ...source.rows, mount: 'foreign' } },
  ]) {
    expect(() => nameBlob('weapons/rifle-page.json', 'json', encode(input), { jsonSchema: schema })).toThrow();
    await expect(product(input).json('weapons/rifle-page.json')).rejects.toThrow('refuses its schema');
  }
});
