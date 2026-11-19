// oxlint-disable-next-line import/no-nodejs-modules -- Writes a product folder for the headless loader.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Hashes the grafted sections as the build does.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolves the repo's own tmp folder.
import { resolve } from 'node:path';
import { GAMEPLAY_SLICE } from './gameplaySlice';

// MIRROR-SALT-ZONE MSZ6: sharddev's vehicles example (packages/sdk/src/shards/vehicles, c4b321f6): its `world/vehicles`
// section as `wildshard check` writes it, two kinds (a two-seat salt buggy, a land-sail) and two docks. sharddev cannot build
// its folder until it pins an engine on format 0.53.0, so the section rides the gameplay slice here, with the two kind panels
// the example declares (invisible library panels, drawn from one of the slice's own models).
export const VEHICLES_EXAMPLE = 'test/fixtures/vehicles-example/world-vehicles.json';
const KIND_PANELS = ['salt.buggy', 'salt.land-sail'];

interface Entry { name: string; path: string; hash: string; bytes: number; schema?: string }
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function put(directory: string, entry: Entry, value: unknown): Entry {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  mkdirSync(resolve(directory, entry.path, '..'), { recursive: true }); writeFileSync(resolve(directory, entry.path), bytes);
  return { ...entry, hash: sha(bytes), bytes: bytes.length };
}

/** A copy of the gameplay slice carrying the example's vehicles, under ./tmp; `dispose` removes it. */
export function vehiclesExampleFolder(): { readonly directory: string; readonly dispose: () => void } {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp/vehicles-example-'));
  cpSync(GAMEPLAY_SLICE, directory, { recursive: true });
  const indexPath = resolve(directory, 'shard.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { sections: Entry[] };
  const props = index.sections.find(row => row.name === 'world/props');
  if (props === undefined) throw new Error('The gameplay slice has no props section');
  const propsValue = JSON.parse(readFileSync(resolve(directory, props.path), 'utf8')) as { props: { panels: { id: string; file: string; visible: boolean }[] } };
  const model = propsValue.props.panels.find(row => !row.visible)?.file;
  if (model === undefined) throw new Error('The gameplay slice has no library panel to lend');
  propsValue.props.panels.push(...KIND_PANELS.map(id => ({ id, file: model, visible: false })));
  const vehicles: Entry = { name: 'world/vehicles', path: 'sections/world/vehicles.json', hash: '', bytes: 0, schema: 'wildshard:world/vehicles@1' };
  index.sections = [...index.sections.map(row => (row.name === 'world/props' ? put(directory, row, propsValue) : row)),
    put(directory, vehicles, JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')))].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(indexPath, JSON.stringify(index));
  return { directory, dispose: () => { rmSync(directory, { recursive: true, force: true }); } };
}
