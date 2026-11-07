import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns its generated product directory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture inside its owned directory.
import { resolve } from 'node:path';
import { NATIVE_ASSEMBLY_DATA_SCHEMA, NATIVE_ASSEMBLY_FILE, NATIVE_ASSEMBLY_SCHEMA, parseNativeAssembly, type NativeAssemblyPlan } from '@wildshard/format/nativeAssembly';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { emptyShardfile } from '../src/shared/host/author';
import { serverBlob } from '../src/sharddev/blobs';
import { HeadlessSimulation } from '../src/server/host/headless';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { validateOutputProduct, writeOutputProduct } from '../src/sharddev/outputProduct';
import { hasNativeAssembly } from '../src/server/game/shardfile/nativeAssembly';
import { prepareProductRuntimePlan } from '../src/server/game/shardfile/nativePlan';

const plan: NativeAssemblyPlan = { kind: 'native-assembly', level: { speed: 5, ground: { size: 500, height: 0 } }, terrain: { kind: 'bake-ground' }, navigation: 'shard',
  bake: { rows: { file: 'server/physics.json' }, reader: { label: 'Fixture', resolution: 256, size: 500 }, ground: 'data/ground.bin', colliders: [], read: 'bake' },
  collision: { resolution: 256 }, entries: { walk: { lanes: 1, walk: 1, start: 1, maxTicks: 1 } }, features: [{ host: 'decisions' }, { host: 'collision', skipOnRestore: true }] };

test('admits plain data plans in declared install order and refuses anything else', () => {
  expect(parseNativeAssembly(plan)).toEqual(plan);
  expect(parseNativeAssembly({ ...plan, features: [{ host: 'population.roster', rows: { section: 'actors/roster', path: ['rows'] } }, { host: 'day.declared', clock: { value: { start: 0 } } }] }).features).toHaveLength(2);
  expect(() => parseNativeAssembly({ ...plan, kind: 'held-melee' })).toThrow();
  expect(() => parseNativeAssembly({ ...plan, features: [] })).toThrow();
  expect(() => parseNativeAssembly({ ...plan, features: [{ host: 'shard.callback' }] })).toThrow();
  expect(() => parseNativeAssembly({ ...plan, features: [{ host: 'decisions', module: 'https://example.test/x.js' }] })).toThrow();
  expect(() => parseNativeAssembly({ ...plan, moduleUrl: 'x' })).toThrow();
  expect(() => parseNativeAssembly({ ...plan, terrain: { kind: 'baked', file: 'server/terrain.bin' } })).toThrow();
  expect(() => parseNativeAssembly({ ...plan, level: () => 0 })).toThrow();
});

test('is a registered platform family for server names only, and held-melee stays its own schema', () => {
  expect(platformFileFamily(NATIVE_ASSEMBLY_FILE, NATIVE_ASSEMBLY_SCHEMA)?.reader).toBe('src/game/shardfile/nativeAssembly.ts');
  expect(platformFileFamily('server/physics.json', NATIVE_ASSEMBLY_DATA_SCHEMA)?.reader).toBe('src/game/shardfile/nativeAssembly.ts');
  expect(platformFileFamily('sim/native-assembly.json', NATIVE_ASSEMBLY_SCHEMA)).toBeUndefined();
  expect(platformFileFamily('data/physics.json', NATIVE_ASSEMBLY_DATA_SCHEMA)).toBeUndefined();
  expect(() => validatePlatformFile(NATIVE_ASSEMBLY_FILE, NATIVE_ASSEMBLY_SCHEMA, { kind: 'native-assembly' })).toThrow();
  expect(() => parseNativeRuntimePlan(plan)).toThrow();
});

test('ships through the server class and takes the dispatch ahead of sim/runtime-plan, on the worker too', async () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'native-assembly-')), directory = resolve(root, 'fixture');
  try {
    const shard = emptyShardfile({ slug: 'native-assembly-fixture', name: 'Assembly', author: 'Test', revision: 1, seed: 3 });
    const server = [serverBlob(NATIVE_ASSEMBLY_FILE, { schema: NATIVE_ASSEMBLY_SCHEMA, value: plan }), serverBlob('server/physics.json', { schema: NATIVE_ASSEMBLY_DATA_SCHEMA, value: {} })];
    const index = writeOutputProduct(shard, new Map(), directory, { server });
    expect(index.admission.server?.map(row => row.name)).toEqual([NATIVE_ASSEMBLY_FILE, 'server/physics.json']);
    expect(index.sections.map(row => row.name)).not.toContain('sim/runtime-plan');
    validateOutputProduct(directory);

    const product = await loadHeadlessProduct(directory);
    expect(hasNativeAssembly(product)).toBe(true);
    expect(parseNativeAssembly(await product.json(NATIVE_ASSEMBLY_FILE))).toEqual(plan);
    await expect(prepareProductRuntimePlan(product, new Map())).rejects.toThrow('needs its server ports');

    // The worker reaches the assembly's own prepare: the fixture has no bake to read, and that is what refuses it.
    await expect(HeadlessSimulation.create(product.shardfile, new Map(), undefined, { deadline: 'advisory', product: directory })).rejects.toThrow(/data\/ground\.bin/u);

    // A changed plan is an invalid product, like any other file.
    writeFileSync(resolve(directory, server[0]?.file.path ?? ''), 'tampered');
    expect(() => validateOutputProduct(directory)).toThrow(/hash|size/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
