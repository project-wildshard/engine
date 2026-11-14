import { afterEach, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Owns a bounded build-only author project fixture.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolves only the owned fixture directory.
import { resolve } from 'node:path';
import { emptyShardfile } from '../src/shared/host/author';
import { mergeProjectSections } from '../src/sharddev/projectSections';
import { readProjectAssets, buildProject } from '../src/sharddev/project';
import { validateOutputFolder } from '../src/sharddev/outputFolder';
import { originalDriftwoodMovers } from './fixtures/driftwood-movers';
import { FIXTURE_RUNTIME_COST } from './fixtures/clientPlanRuntime';

const movers = originalDriftwoodMovers();

const directories: string[] = [];
const source = () => {
  const shard = emptyShardfile({ slug: 'sections-test', name: 'Sections', author: 'Test', revision: 1, seed: 3 });
  shard.runtime = { kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds: ['movers'] };
  return shard;
};
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true }); });

test('root-mapped sections preserve actual mover rows and refuse conflicting or unknown fields', () => {
  const original = source(), merged = mergeProjectSections(original, { 'world/movers': { movers } });
  expect(merged.movers).toEqual(movers);
  expect(original.movers).toEqual([]);
  expect(() => mergeProjectSections(merged, { 'world/movers': { movers } })).toThrow('conflicts');
  expect(() => mergeProjectSections(original, { 'world/movers': { movers, identity: original.identity } })).toThrow('undeclared');
  expect(() => mergeProjectSections(original, { 'world/missing': {} })).toThrow('Unknown platform');
  expect(() => mergeProjectSections(original, { 'world/movers': { movers: [{ ...movers[0], execution: 'silent-fallback' }] } })).toThrow();
  expect(() => mergeProjectSections(original, { 'world/movers': () => movers })).toThrow('Invalid authored');
});

test('the real sidecar pipeline emits one canonical section from declared data without a config import', async () => {
  mkdirSync('tmp', { recursive: true });
  const path = mkdtempSync(resolve('tmp', 'project-sections-')); directories.push(path);
  mkdirSync(resolve(path, 'generators'));
  writeFileSync(resolve(path, 'shard.config.ts'), `export default ${JSON.stringify(source())};`);
  writeFileSync(resolve(path, 'generators/output.ts'), `export const output = {}; export const sections = ${JSON.stringify({ 'world/movers': { movers } })};`);
  expect((await readProjectAssets(path)).shard.movers).toEqual(movers);
  // a client-plan project's output is separate from its author folder (the runtime copy refuses an overlap)
  const destination = mkdtempSync(resolve('tmp', 'project-sections-out-')); directories.push(destination);
  await buildProject(path, destination, { client: null });
  const checked = validateOutputFolder(destination);
  expect(checked.index.sections.filter(row => row.name === 'world/movers')).toHaveLength(1);
  expect(JSON.parse(readFileSync(resolve(destination, 'sections/world/movers.json'), 'utf8'))).toEqual({ movers });
  expect(checked.shard.movers).toEqual(movers);
});
