import { expect, test } from 'vitest';
import { worldSceneGraphPages } from '../src/sharddev/worldScenes';
import { parseWorldSceneWeld, sceneFileKey } from '@wildshard/format/worldSceneWeld';
import { parseWorldScenePage, worldScenePageWeld, sceneWeldBytes, sceneLivingBytes } from '@wildshard/format/worldScenePages';
import { registeredJsonContract } from '@wildshard/format/registeredJson';
import { registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { platformFileFamily } from '@wildshard/format/platformFileFamilies';
import { admitWorldSceneModelGraphs } from '../src/client/game/shardfile/worldSceneWeld';
import { parseWorldSceneModels } from '@wildshard/format/worldSceneModels';
import { validateFixtureJsonValue } from './fixtures/defined-json-value';
import { encodeCanonicalJson } from '../src/shared/host/immutable';

const graph = (name: string) => parseWorldSceneWeld({ id: name, root: 'root', nodes: [
  { kind: 'group', id: 'shared', parent: 'root' },
  { kind: 'light', id: 'light', parent: 'shared', color: 1, intensity: 1, distance: 1, decay: 2 },
] });

test('native variants reconstruct from shared nodes with independent member identities', async () => {
  const original = [graph('phone'), graph('desktop')];
  const pages = worldSceneGraphPages('specimens', 'weld', original.map((row, i) => ({ name: String(i), row })));
  expect(pages.files).toHaveLength(1);
  const blob = pages.files[0];
  if (blob === undefined) throw new Error('Missing native graph page');
  const page = parseWorldScenePage(JSON.parse(new TextDecoder().decode(blob.bytes)));
  expect(page.nodes).toHaveLength(2);
  const references = [...pages.references.values()];
  expect(new Set(references.map(sceneFileKey)).size).toBe(2);
  for (const [i, reference] of references.entries()) expect(sceneWeldBytes(blob.bytes, reference)).toEqual(original[i]);
  const catalogue = parseWorldSceneModels({ product: 'page-contract', models: [{ key: 'model', id: 'page-contract/model', name: 'Model', file: 'source', category: 'props', pipeline: 'code', defaults: {}, variants: [], assembly: 'scene',
    choices: [{ id: 'only', params: {}, size: [1, 1, 1], draws: [], colliders: [], scene: { phone: references[0], desktop: references[1] } }] }] });
  const admitted = await admitWorldSceneModelGraphs({ hasFile: name => name === blob.file.name, file: () => Promise.resolve(blob.bytes) }, catalogue);
  expect([...admitted.values()]).toEqual(original);
  expect(() => sceneWeldBytes(blob.bytes, { file: 'page', member: 2 })).toThrow('Missing native weld page member');
  expect(() => sceneLivingBytes(blob.bytes, { file: 'page', member: 0 })).toThrow('living page');
  const changed = Uint8Array.from(blob.bytes);
  sceneWeldBytes(changed, { file: 'page', member: 0 });
  changed[0] = 32;
  expect(() => sceneWeldBytes(changed, { file: 'page', member: 0 })).toThrow('byte owner changed');
});

test('page admission checks unselected native graphs and refuses malformed transport', () => {
  const result = worldSceneGraphPages('native', 'weld', [{ name: 'native', row: graph('native') }]);
  const blob = result.files[0];
  if (blob === undefined) throw new Error('Missing native graph page');
  const page = parseWorldScenePage(JSON.parse(new TextDecoder().decode(blob.bytes)));
  if (page.kind !== 'weld') throw new Error('Expected native weld page');
  const row = page.rows[0];
  if (row === undefined) throw new Error('Missing native row');
  expect(() => worldScenePageWeld(structuredClone(page), 0)).toThrow('Unadmitted native scene page');
  expect(Object.isFrozen(page.nodes[0])).toBe(true);
  const malformed = { id: 'malformed', root: 'root', nodes: [{ kind: 'light', id: 'light', parent: 'root', color: 1, intensity: Number.NaN, distance: 1, decay: 2 }] };
  expect(() => parseWorldSceneWeld(malformed)).toThrow();
  expect(() => parseWorldSceneWeld(Object.freeze(malformed))).toThrow();
  expect(() => parseWorldScenePage({ ...page, nodes: malformed.nodes })).toThrow();
  expect(() => parseWorldScenePage({ ...page, rows: [row, { ...row, nodes: [65535] }] })).toThrow();
  expect(() => parseWorldScenePage({ ...page, rows: [row, { ...row, nodes: [0, 0] }] })).toThrow();
  expect(() => parseWorldScenePage({ ...page, callback: () => undefined })).toThrow();
  expect(() => parseWorldScenePage({ ...page, rows: Array.from({ length: 17 }, () => row) })).toThrow();
  const accessor = Object.defineProperty({}, 'version', { enumerable: true, get: () => 1 });
  expect(() => parseWorldScenePage(accessor)).toThrow();
  expect(() => worldSceneGraphPages('../escape', 'weld', [])).toThrow();
});

test('packing preserves the authored wire order before native parser defaults', () => {
  const row = structuredClone(graph('ordered'));
  row.materials.unshift({ id: 'glow', kind: 'basic', properties: { transparent: true, depthWrite: false }, blending: 2, fog: false, sky: false });
  const result = worldSceneGraphPages('ordered', 'weld', [{ name: 'ordered', row }]);
  const blob = result.files[0];
  if (blob === undefined) throw new Error('Missing ordered graph page');
  const wire = JSON.parse(new TextDecoder().decode(blob.bytes)) as { nodes: unknown[]; rows: { nodes: number[] }[] };
  const packed = wire.rows[0];
  if (packed === undefined) throw new Error('Missing ordered graph member');
  expect(JSON.stringify({ ...packed, nodes: packed.nodes.map(at => wire.nodes[at]) })).toBe(JSON.stringify(row));
});

test('page metadata fits the product index while local references retain node constraints', () => {
  const result = worldSceneGraphPages('schema-budget', 'weld', [{ name: 'native', row: graph('native') }]);
  const blob = result.files[0];
  if (blob === undefined) throw new Error('Missing schema budget page');
  const schema = new TextEncoder().encode(encodeCanonicalJson(registeredJsonSchema('world/scene-pages/schema-budget.0.json')));
  // Sixteen family pages must leave room for the rest of Pine's 2 MB index.
  expect(schema.byteLength).toBeLessThan(36_000);
  const page = parseWorldScenePage(JSON.parse(new TextDecoder().decode(blob.bytes)));
  expect(() => validateFixtureJsonValue(schema, page)).not.toThrow();
  expect(() => validateFixtureJsonValue(schema, { ...page, nodes: [{ kind: 'light', id: 'light', parent: 'root', color: 1, intensity: -1, distance: 1, decay: 2 }] })).toThrow();
  expect(() => validateFixtureJsonValue(schema, { ...page, nodes: [{ kind: 'group', id: 'group', parent: 'root', unexpected: true }] })).toThrow();
});

test('native pages keep the aggregate JSON ceiling and complete defining provenance', () => {
  const large = structuredClone(graph('large'));
  const group = large.nodes.find(node => node.kind === 'group');
  if (group === undefined) throw new Error('Missing parsed group fixture');
  large.nodes = Array.from({ length: 1800 }, (_, i) => ({ ...group, id: `part-${i}`, parent: 'root' }));
  const result = worldSceneGraphPages('bounded', 'weld', Array.from({ length: 16 }, (_, i) => ({ name: String(i), row: { ...large, id: String(i), root: `root-${i}`, nodes: large.nodes.map(node => { const copy = structuredClone(node); copy.parent = `root-${i}`; return copy; }) } })));
  expect(result.files.length).toBeGreaterThan(1);
  for (const blob of result.files) {
    const name = blob.file.name;
    if (name === undefined) throw new Error('Missing native page name');
    expect(blob.file.jsonSchema?.['$comment']).toBe('@wildshard/format/worldScenePages#WorldScenePageSchema');
    expect(platformFileFamily(name, String(blob.file.jsonSchema?.['$comment']))).toBeDefined();
    parseWorldScenePage(JSON.parse(new TextDecoder().decode(blob.bytes)));
  }
  const name = 'world/scene-pages/bounded.0.json';
  expect(registeredJsonSchema(name)['$comment']).toBe(registeredJsonContract(name)?.source);
  expect(() => registeredJsonContract('world/scene-pages/../private.json')).toThrow();
  expect(platformFileFamily(name, '@wildshard/format/worldSceneWeld#WorldSceneWeldSchema')).toBeUndefined();
  expect(platformFileFamily('world/island/plan-phone.json', '@wildshard/format/bakedTiles#BakedPlacementPlanSchema')).toBeDefined();
});
