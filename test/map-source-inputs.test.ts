// oxlint-disable-next-line import/no-nodejs-modules -- Compare authored inputs across owned installation layouts.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep fixture trees under repository scratch.
import { dirname, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { expect, test } from 'vitest';
import { mapInputHashes, mapTilesHash, mapInputRoots, mapSettings } from '../scripts/map-hash.mjs';

test('map keys ignore installed launchers while retaining source and lockfile bytes', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/map-source-inputs-'));
  const put = (path: string, value: string): void => {
    const target = resolve(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
  };
  try {
    put('look/map.json', JSON.stringify({ why: 'source closure fixture', inputs: ['sdk', 'pnpm-lock.yaml'] }));
    put('sdk/terrain.ts', 'export const height = 12;'); put('pnpm-lock.yaml', 'compiler: pinned-1');
    const isolated = mapTilesHash(root);
    put('sdk/node_modules/.bin/asc', 'checkout-specific launcher');
    put('sdk/nested/node_modules/.bin/tool', 'another installed launcher');
    expect(mapTilesHash(root)).toBe(isolated);
    put('sdk/node_modules/.bin/asc', 'CI-specific launcher');
    expect(mapTilesHash(root)).toBe(isolated);
    expect(Object.keys(mapInputHashes(root))).toEqual(['look/map.json', 'pnpm-lock.yaml', 'sdk/terrain.ts']);
    put('sdk/terrain.ts', 'export const height = 13;'); expect(mapTilesHash(root)).not.toBe(isolated);
    put('sdk/terrain.ts', 'export const height = 12;'); expect(mapTilesHash(root)).toBe(isolated);
    put('pnpm-lock.yaml', 'compiler: pinned-2'); expect(mapTilesHash(root)).not.toBe(isolated);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


/** Follow declared module inputs without running producers or reading their retired handoffs. */
function programInputs(entry: string): Set<string> {
  const files = new Set<string>();
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true };
  for (const dependency of ts.preProcessFile(readFileSync(entry, 'utf8')).importedFiles) {
    const found = ts.resolveModuleName(dependency.fileName, entry, options, ts.sys).resolvedModule;
    if (found === undefined) throw new Error(`Unresolved map program input ${dependency.fileName} from ${entry}`);
    files.add(resolve(found.resolvedFileName));
  }
  return files;
}

/** Every file a shard's generators reach through imports, across layers, packages' exports included. */
function generatorClosure(shard: string): Set<string> {
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true, allowImportingTsExtensions: true };
  const generators = resolve(shard, 'generators');
  const seen = new Set(readdirSync(generators).filter(name => /\.m?[jt]s$/u.test(name) && !name.endsWith('.test.ts')).map(name => resolve(generators, name)));
  for (const file of seen) for (const dependency of ts.preProcessFile(readFileSync(file, 'utf8')).importedFiles) {
    const found = ts.resolveModuleName(dependency.fileName, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (found === undefined || found.includes('/node_modules/.pnpm/') || !/\.[cm]?[jt]s$/u.test(found)) continue;
    seen.add(realpathSync(found));
  }
  return seen;
}

// A map hashes the SDK files it reads, so an export or a file it doesn't read can't rewrite a template's bytes.
test.each(['_template', 'pastel-plain'])('%s map names exactly the SDK files its generators reach', (slug) => {
  const shard = resolve('src/shards', slug), sdk = `${resolve('src/sdk')}/`;
  const declared = mapInputRoots(shard).filter(root => `${root}/`.startsWith(sdk));
  expect(declared).toEqual([...generatorClosure(shard)].filter(file => file.startsWith(sdk)).sort());
}, 60_000);

test('source-owned maps declare their program and its defining raster inputs', () => {
  // Open Plots paints each output inside its product; other maps have a named map program.
  for (const slug of ['blender-template', 'driftwood-isle', 'far-reach', 'ink-cel-valley', 'nalati-grasslands',
    'nine-dragon-stack', 'open-plots', 'pine-hollow', 'sunscar-dunes']) {
    const dir = resolve('src/shards', slug), roots = mapInputRoots(dir);
    const program = resolve(dir, 'generators', slug === 'open-plots' ? 'product.ts' : 'mapProgram.ts');
    expect(mapSettings(dir).inputs.length).toBeGreaterThan(0);
    expect(roots.some(root => program === root || program.startsWith(`${root}/`))).toBe(true);
    const inputs = programInputs(program);
    expect(inputs, `${slug} raster entry`).toContain(resolve('src/sharddev/bake/groundMap.ts'));
  }
  const rasterInputs = programInputs(resolve('src/sharddev/bake/groundMap.ts'));
  for (const source of ['mapScenes', 'mapRaster']) {
    expect(rasterInputs).toContain(resolve(`src/sharddev/bake/${source}.ts`));
  }
  const nineRoots = mapInputRoots(resolve('src/shards/nine-dragon-stack'));
  for (const source of ['mapAssembly', 'mapScenes', 'mapRaster', 'groundMap']) {
    expect(nineRoots).toContain(resolve(`src/sharddev/bake/${source}.ts`));
  }
  expect(nineRoots).toContain(resolve('src/sharddev/kit/geometryPack.ts'));
  expect(nineRoots).toContain(resolve('src/commons/bake/portableMath.ts'));
  expect(nineRoots).toContain(resolve('src/shards/nine-dragon-stack/data/map.json'));
  expect(nineRoots).not.toContain(resolve('scripts/map-painter.mjs'));
});

test.each(['look', 'data'])('%s map declarations invalidate on raster and scene edits', (layout) => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/map-raster-source-')), shard = resolve(root, 'shards/fixture');
  try {
    mkdirSync(resolve(shard, layout), { recursive: true }); mkdirSync(resolve(root, 'sdk/bake'), { recursive: true });
    const source = resolve(root, 'sdk/bake/mapRaster.ts');
    writeFileSync(resolve(shard, layout, 'map.json'), JSON.stringify({ why: 'raster source fixture', inputs: ['../../sdk/bake/mapRaster.ts', '../../sdk/bake/mapScenes.ts'] }));
    const scenes = resolve(root, 'sdk/bake/mapScenes.ts'); writeFileSync(scenes, 'export const scenes = 1;');
    writeFileSync(source, 'export const source = 1;'); const original = mapTilesHash(shard);
    expect(Object.keys(mapInputHashes(shard))).toEqual(['../../sdk/bake/mapRaster.ts', '../../sdk/bake/mapScenes.ts', `${layout}/map.json`]);
    writeFileSync(source, 'export const source = 2;'); expect(mapTilesHash(shard)).not.toBe(original);
    writeFileSync(source, 'export const source = 1;'); expect(mapTilesHash(shard)).toBe(original);
    writeFileSync(scenes, 'export const scenes = 2;'); expect(mapTilesHash(shard)).not.toBe(original);
    writeFileSync(scenes, 'export const scenes = 1;'); expect(mapTilesHash(shard)).toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
