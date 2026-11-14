import { expect, test } from 'vitest';
import { registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { modelSceneSourceFile, bakedSceneSourceFile } from '@wildshard/sharddev/worldScenes';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';
import { prepareSceneSources, sceneModelDefinition } from '@wildshard/engine/game/shardfile/sceneSources';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { platformFileFamily } from '@wildshard/format/platformFileFamilies';

const model = { rows: { meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 0.2 } };
const bake = { rows: {}, urls: {} };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('both actual source families attach exact platform metadata and preserve bytes', () => {
  for (const name of ['world/sources/sky.json', 'world/sources/heroes.json', 'world/sources/models.json'] as const) {
    const blob = modelSceneSourceFile(name, model);
    expect(blob.bytes).toEqual(encode(model));
    expect(blob.file.jsonSchema).toEqual(registeredJsonSchema(name));
    expect(platformFileFamily(name, blob.file.jsonSchema?.['$comment'] as string)?.reader).toBe('src/game/shardfile/sceneSources.ts');
  }
  const blob = bakedSceneSourceFile('world/sources/bakes.json', bake);
  expect(blob.bytes).toEqual(encode(bake));
  expect(blob.file.jsonSchema).toEqual(registeredJsonSchema('world/sources/bakes.json'));
  for (const name of ['world/sources/bakes.json', 'world/sources/models.json'] as const) {
    expect(() => nameBlob(name, 'json', encode({ ...bake, opaque: {} }), { jsonSchema: registeredJsonSchema(name) })).toThrow();
    expect(platformFileFamily(`${name}.other`, blob.file.jsonSchema?.['$comment'] as string)).toBeUndefined();
  }
});

test('the native reader refuses a malformed cold pool before publishing any model library', async () => {
  const identity = { slug: 'cold-source', name: 'Cold source', author: 'Test', revision: 1, seed: 1 };
  const value = { rows: { ...model.rows, geometryPools: [{ url: 'cold.glb', parts: ['rest'], native: { requireIndex: 'bad' } }] } };
  let reads = 0;
  const product = createShardFolder({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity),
    sections: new Map([['world/scenes', parseWorldScenes({ version: 1, libraries: [{ id: 'models', kind: 'models', file: 'world/sources/models.json' }], materials: [], steps: [] })]]),
    // Simulate build admission so this negative reaches the original native pool parser.
    builtJson: true, files: new Map([['world/sources/models.json', { hash: 'source', url: '/models', jsonSchema: registeredJsonSchema('world/sources/models.json') }]]),
    read: () => { reads++; return Promise.resolve(encode(value)); } });
  await expect(prepareSceneSources(product)).rejects.toThrow();
  expect(reads).toBe(1);
  expect(() => sceneModelDefinition(product, 'models')).toThrow('not prepared');
});
