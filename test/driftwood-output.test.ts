import { expect, test } from 'vitest';
import * as v from 'valibot';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { builtFolder } from './fixtures/builtFolder';
import { ResolvedIslandLibrarySchema } from '@wildshard/format/islandLibrary';
import { BAKED_COVE } from './fixtures/driftwood-baked-cove';

test('Driftwood fixed draws and island cover files name admitted product blobs (no legacy URL table)', async () => {
  const root = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(root), output = outputDescriptor(product.shardfile);
  const row = output?.index.sections.find(value => value.name === 'models/island-library');
  if (output === undefined || row === undefined) throw new Error('Fixed layouts absent');
  expect(output.index.sections.some(value => value.name === 'custom/assets')).toBe(false);
  expect(row.schema).toBe('wildshard:models/island-library@1');
  expect(product.hasFile('custom/fixedLayouts')).toBe(false);
  expect(product.hasFile('custom/collections')).toBe(false);
  const value = product.section('models/island-library');
  const layouts = v.parse(ResolvedIslandLibrarySchema, value), files = output.index.files.filter(file => file.name !== undefined), names = new Set(files.map(file => file.name));
  for (const name of [...layouts.draws.map(draw => 'file' in draw ? draw.file : draw.slot), BAKED_COVE.wear?.files.phone.file, BAKED_COVE.wear?.files.desktop.file]) {
    expect(names.has(name), name).toBe(true);
    if (name === undefined) throw new Error('Missing expected fixed-layout blob');
    expect((await product.file(name)).byteLength).toBeGreaterThan(0);
  }
  expect(new Set(files.map(file => file.hash)).size).toBe(files.length);
}, 30000);
