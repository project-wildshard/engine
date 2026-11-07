import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- These tests own their tiny product fixture.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the owned product fixture.
import { resolve } from 'node:path';
import { PLATFORM_FILE_FAMILIES, platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { registeredJsonSchema, namedFormatJsonSchemas } from '@wildshard/engine/host/formatJsonSchema';
import { hashImmutableBytes } from '@wildshard/engine/host/immutable';
import { outputSections } from '../scripts/shard-platform-output.mjs';
import { namedJsonRoutes, productSectionEntries, sectionInventory } from '../scripts/section-inventory';
import { platformOutput } from './fixtures/platformOutputs';

const source = '@wildshard/format/questSteps#QuestServiceActionsSchema';
const name = 'quests/services.json';
const good = { version: 1, actions: [{ id: 'hello', effects: [{ kind: 'toast', text: 'Hello' }] }] };

test('complete cast and fabric weld roots register without admitting neighbouring private names', () => {
  const defining = '@wildshard/format/worldSceneWeld#WorldSceneWeldSchema';
  const value = { id: 'quay', root: 'root', nodes: [] };
  for (const fileName of ['world/casts.json', 'world/fabric.json']) {
    const before = JSON.stringify(value);
    expect(platformFileFamily(fileName, defining)?.reader).toBe('src/game/shardfile/worldSceneWeld.ts');
    expect(validatePlatformFile(fileName, defining, value)).toBeDefined();
    expect(JSON.stringify(value)).toBe(before);
    expect(() => validatePlatformFile(fileName, defining, { ...value, nodes: [{ kind: 'mesh' }] })).toThrow();
    expect(platformFileFamily(fileName, 'private')).toBeUndefined();
  }
  expect(platformFileFamily('world/casts-extra.json', defining)).toBeUndefined();
});

test('shared names require the defining type and keep private neighbours custom', () => {
  expect(platformFileFamily(name, source)?.reader).toBe('src/game/quest/effects.ts');
  for (const [file, schema] of [[name, undefined], [name, 'private'], ['private/services.json', source],
    ['world/placements/private.json', '@wildshard/format/worldScenePlacement#WorldScenePlacementSchema'],
    ['scenes/cabins-phone-shadow-true.json', '@wildshard/format/worldSceneWeld#WorldSceneWeldSchema']]) {
    if (file === undefined) throw new Error('Missing family test name');
    expect(platformFileFamily(file, schema)).toBeUndefined();
  }
  // Format names a reader by its side-free identity: a retag must not need a format release.
  // v0.4.0 still names the wildlife page the feed's cut deleted. Its rows are read here until format moves at the lift.
  const retired = new Map([['src/game/population/wildlife.ts', 'src/game/population/wildlifeFeature.ts']]);
  for (const family of PLATFORM_FILE_FAMILIES) {
    const reader = retired.get(family.reader) ?? family.reader;
    const onDisk = ['client', 'server', 'shared'].map(side => reader.replace('src/game/', `src/game/${side}/`)).find(path => existsSync(path));
    expect(readFileSync(onDisk ?? reader, 'utf8').length).toBeGreaterThan(0);
  }
});

test('native family admission refuses forged values without rewriting accepted bytes', () => {
  const before = JSON.stringify(good);
  validatePlatformFile(name, source, good);
  expect(JSON.stringify(good)).toBe(before);
  expect(() => validatePlatformFile(name, source, {})).toThrow();
  expect(() => validatePlatformFile(name, source, { ...good, actions: [...good.actions, ...good.actions] })).toThrow();
});

test('emitted routes follow nested documents, shared descendants and cycles', () => {
  const roots = new Map<string, unknown>([['client/plan', { file: 'a.json' }], ['world/scenes', { file: 'b.json' }]]);
  const documents = new Map<string, unknown>([['a.json', { file: 'b.json' }], ['b.json', { children: ['a.json', 'leaf.json'] }], ['leaf.json', {}], ['unread.json', {}]]);
  expect(namedJsonRoutes(roots, documents)).toEqual({ 'a.json': ['client/plan', 'world/scenes'], 'b.json': ['client/plan', 'world/scenes'], 'leaf.json': ['client/plan', 'world/scenes'] });
});

test('gate and census exclude only admitted families and retain hash, schema and route evidence', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'platform-file-family-'));
  try {
    platformOutput(root, 'demo', {}, { 'client/plan': JSON.stringify({ features: [{ file: name }] }) });
    const folder = resolve(root, 'out/demo'), indexPath = resolve(folder, 'shard.json');
    const index = parseOutputIndex(JSON.parse(readFileSync(indexPath, 'utf8')));
    const publish = (value: unknown, jsonSchema: Readonly<Record<string, unknown>> | undefined): void => {
      // Preserve this deliberately noncanonical order/whitespace: a census is not an encoder.
      const text = ` ${JSON.stringify(value)}\n`, bytes = new TextEncoder().encode(text), hash = hashImmutableBytes(bytes), path = `blobs/json/${hash}.json`;
      mkdirSync(resolve(folder, 'blobs/json'), { recursive: true }); writeFileSync(resolve(folder, path), bytes);
      writeFileSync(indexPath, JSON.stringify({ ...index, files: [{ name, path, hash, kind: 'json', compressed: bytes.length, decoded: bytes.length, gpu: 0, triangles: 0, draws: 0, critical: false, dependencies: [], ...(jsonSchema === undefined ? {} : { jsonSchema }) }] }));
    };
    const schema = registeredJsonSchema(name); publish(good, schema);
    expect(outputSections(root, 'demo').customSections).toEqual([]);
    const product = productSectionEntries(folder, 'demo', 'demo');
    expect(product.entries.find(row => row.name === name)).toMatchObject({ kind: 'platform-file', routes: ['client/plan'] });
    const report = sectionInventory([product], namedFormatJsonSchemas(), { 'client/plan': 'plan' }, [], []);
    expect(report.rows.find(row => row.name === name)).toMatchObject({ provenance: 'verified-format', registeredReader: 'src/game/quest/effects.ts' });
    publish(good, undefined); expect(()=>outputSections(root, 'demo')).toThrow('Unregistered named JSON');
    publish({}, { $comment: source }); expect(() => outputSections(root, 'demo')).toThrow();
    publish(good, schema);
    const emitted = parseOutputIndex(JSON.parse(readFileSync(indexPath, 'utf8'))).files[0];
    if (emitted === undefined) throw new Error('Missing emitted fixture');
    writeFileSync(resolve(folder, emitted.path), '{}'); expect(() => outputSections(root, 'demo')).toThrow('hash/size');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
