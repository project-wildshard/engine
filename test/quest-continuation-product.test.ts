import { QuestPageSchema } from '@wildshard/format/questPageComposition';
import * as v from 'valibot';
import { expect,test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { builtFolder } from './fixtures/engine-lift/folder';

test('the published page continuation admits its document and refuses executable owners and corrupt loot', async () => {
  const product = await loadHeadlessFolder(builtFolder('driftwood-isle'));
  const file = outputDescriptor(product.shardfile)?.index.files.find(row => row.name === 'quests/page-composition.json');
  if (file?.jsonSchema === undefined) throw new Error('Missing defining continuation schema');
  const bytes = await product.file('quests/page-composition.json');
  const page = v.parse(QuestPageSchema, validateNamedJsonSchema(file.jsonSchema, bytes));
  const rows = page.entryResources?.continuation;
  if (rows === undefined) throw new Error('Missing admitted page continuation');
  for (const bad of [
    { ...rows, owner: 'runtime', path: ['call'] },
    { ...rows, cosmetics: { ...rows.cosmetics, models: { hat: 4 } } },
    { ...rows, loot: { ...rows.loot, minimap: 'yes' } },
    { ...rows, collections: '../not-a-section?' },
  ]) {
    const wire = new TextEncoder().encode(JSON.stringify({ ...page, entryResources: { ...page.entryResources, continuation: bad } }));
    expect(() => validateNamedJsonSchema(file.jsonSchema, wire)).toThrow('refuses its schema');
  }
});
