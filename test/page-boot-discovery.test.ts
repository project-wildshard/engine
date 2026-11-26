import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the fixture's own source root.
import { resolve } from 'node:path';
import { parseManifestMetadata } from '@wildshard/format/minimap';
import { parseDiscoveryValues } from '@wildshard/format/discoveryValues';
import { authoredManifestSource } from '../src/scripts/authored-manifest.mjs';

const root = resolve(import.meta.dirname, '..');
const image = 'data:image/', art = { world: image, models: image, sets: image, practice: image };
const manifest = parseManifestMetadata({
  slug: 'fixture', status: 'live', order: 1, api: 1, name: 'Fixture', label: 'Fixture', seed: 1, biome: 'fixture', blurb: 'fixture',
  card: { thumb: image, portrait: image, landscape: image }, style: 'fixture', kitLook: 'toon', weapon: 'sword', treeCount: 0,
  trees: { noun: 'trees' }, assetGlobs: [], spawn: { x: 0, z: 0, yaw: 0 },
  sky: { sunColor: [0, 0, 0], sunIntensity: 0, envIntensity: 0, bgIntensity: 0, fogSunColor: [0, 0, 0], cloudSunColor: [0, 0, 0], hemiSky: 0, hemiGround: 0, hemiIntensity: 0 },
  atmosphere: { fogHeight: 0, fogHeightFalloff: 0, fogHeightDensity: 0, fogDistDensity: 0, volumetricSunColor: [0, 0, 0] },
  grade: { saturation: 0, brightness: 0, contrast: 0, bloomIntensity: 0, bloomThreshold: 0, shadowTint: [0, 0, 0], highTint: [0, 0, 0], lift: [0, 0, 0], gain: [0, 0, 0], gamma: 1 },
  minimap: { image }, pois: [], explore: { art }, audio: { ambience: 'fixture', score: 'fixture' },
  bindings: { accent: 'fixture', budgets: { module: './budgets.generated', export: 'default' } },
});
const boot = { platform: 'page-mode', rows: { module: './data/bootMetadata.generated.json', export: 'default' } };
const ktx2 = { platform: 'page-mode', rows: { module: './data/gpuTables.generated.json', export: 'default' } };
test('page boot discovery keeps GPU rows inside the lazy KTX2 call', () => {
  const source = authoredManifestSource(root, 'fixture', { metadataOnly: true,
    composed: { ...manifest, bindings: { ...manifest.bindings, boot, ktx2 } } });
  expect(source).toContain('bootBindings: pageModeBoot(');
  expect(source).toContain('ktx2: async () =>');
  expect(source).toContain('pageModeKtx2((await import("./data/gpuTables.generated.json", { with: { type: \'json\' } })).default)');
  expect(source).not.toMatch(/^import .*gpuTables/gmu);
  expect(source).not.toContain('./runtime/boot/files');
  expect(source).not.toContain('./runtime/boot/gpuTable');
});

test('page boot program bindings take both page modes from the discovery values', () => {
  const sources = { modes: { phone: { img: { sky: ['/sky.webp'] }, ktx2: {} }, desktop: { img: {}, ktx2: {} } } };
  const gpu = { phone: { '/sky.png': '/sky.ktx2' }, desktop: {} };
  const discovery = parseDiscoveryValues({ 'boot.pageModes': { shard: sources, grid: sources, bakedUnreadPrefixes: ['cabins'] },
    'ktx2.pageModes': { shard: gpu, grid: gpu } });
  const composed = { ...manifest, bindings: { ...manifest.bindings, boot: { platform: 'page-mode', rows: { program: true } },
    ktx2: { platform: 'page-mode', rows: { program: true } } } };
  expect(parseManifestMetadata(composed)).toEqual(composed);
  const source = authoredManifestSource(root, 'fixture', { metadataOnly: true, composed, discovery });
  expect(source).toContain(`bootBindings: pageModeBoot(${JSON.stringify(discovery['boot.pageModes'])})`);
  expect(source).toContain(`ktx2: async () => pageModeKtx2(${JSON.stringify(discovery['ktx2.pageModes'])})`);
  expect(() => authoredManifestSource(root, 'fixture', { metadataOnly: true, composed })).toThrow('program discovery value boot.pageModes');
});

test('page boot bindings refuse recipes, executable sources and ignored options', () => {
  const binding = (value: unknown): unknown => ({ ...manifest, bindings: { ...manifest.bindings, boot: value } });
  expect(() => parseManifestMetadata(binding(boot))).not.toThrow();
  expect(() => parseManifestMetadata(binding({ ...boot, recipe: [] }))).toThrow();
  expect(() => parseManifestMetadata(binding({ ...boot, rows: { ...boot.rows, module: './boot.ts' } }))).toThrow();
  expect(() => parseManifestMetadata(binding({ ...boot, rows: { ...boot.rows, export: 'factory' } }))).toThrow();
  expect(() => parseManifestMetadata({ ...manifest, bindings: { ...manifest.bindings, ktx2: { ...ktx2, option: true } } })).toThrow();
});
