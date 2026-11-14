import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read committed authored metadata for the compiler fixture.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the source fixture within its own clean tree.
import { resolve } from 'node:path';
import { parseManifestMetadata } from '@wildshard/format/minimap';
import { defineAuthoredShard, declaredForestQueries, declaredGround } from '../src/client/game/shard/manifest';
import { toLevelSpec } from '../src/client/game/shard/spec';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = parseManifestMetadata(JSON.parse(readFileSync(resolve(root, 'src/shards/_template/manifest.json'), 'utf8')));
const { load: _load, entry: _entry, ...bindings } = fixture.bindings;
const entry = { platform: 'client-plan', retainHomeRuntime: true, stagesOwner: 'declared' };
const metadata = (patch: object): unknown => ({ ...fixture, ...patch });

test('authored metadata and emitter refuse both trusted entry forms and runtime selection', () => {
  for (const rejected of [
    { legacy: './runtime/legacy', retainHomeRuntime: true, stagesOwner: 'declared' },
    { native: { module: './plugin', export: 'FixturePlugin' }, retainHomeRuntime: true, stagesOwner: 'declared' },
    { ...entry, nativePlan: true }, { ...entry, nativePlan: { phases: ['kit'] } },
  ]) {
    const data={ ...fixture, bindings: { ...bindings, entry: rejected } };
    expect(() => parseManifestMetadata(data)).toThrow();
    expect(() => authoredManifestSource(root, fixture.slug, {metadataOnly:true, composed:data})).toThrow();
  }
  for (const runtimeEntry of ['runtime/index.ts','runtime/hybrid.ts']) {
    const data={ ...fixture, runtimeEntry, bindings: { ...bindings, entry } };
    expect(() => parseManifestMetadata(data)).toThrow();
    expect(() => authoredManifestSource(root,fixture.slug,{metadataOnly:true,composed:data})).toThrow();
  }
});

test('authored bindings admit only canonical JSON or generated modules', () => {
  for (const module of ['./data/budgets.json','./data/budgets.generated','./data/budgets.generated.json']) {
    expect(() => parseManifestMetadata({...fixture,bindings:{...bindings,budgets:{module,export:'default'}}})).not.toThrow();
  }
  for (const module of ['./runtime/index','./runtime/index.ts','./data/budgets.ts','./data/../budgets.json','./data//budgets.json']) {
    const data={...fixture,bindings:{...bindings,budgets:{module,export:'default'}}};
    expect(() => parseManifestMetadata(data)).toThrow();
    expect(() => authoredManifestSource(root,fixture.slug,{metadataOnly:true,composed:data})).toThrow();
    for (const key of ['load','ktx2']) expect(() => parseManifestMetadata({...fixture,bindings:{...bindings,[key]:{module}}})).toThrow();
  }
});

test('fixed boot and art bindings stay independent of page mode and lazy graph loading', () => {
  const scratch = mkdtempSync(resolve(root, 'tmp/manifest-fixed-boot-'));
  const folder = resolve(scratch, 'src/shards/_template');
  mkdirSync(resolve(folder, 'boot'), { recursive: true });
  mkdirSync(resolve(folder, 'explore'), { recursive: true });
  mkdirSync(resolve(folder, 'data'), { recursive: true });
  writeFileSync(resolve(folder, 'data/budgets.json'), readFileSync(resolve(root, 'src/shards/_template/data/budgets.json')));
  const art = '/src/shards/_template/explore/fixed-binding.svg';
  writeFileSync(resolve(folder, 'boot/explore.generated.json'), JSON.stringify({ art: [art] }));
  writeFileSync(resolve(folder, 'explore/fixed-binding.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  try {
    const data = parseManifestMetadata(metadata({ bindings: { ...bindings, entry,
      boot: { files: { module: './boot/files.generated.json', export: 'default' },
        sources: { module: './boot/sources.generated.json', export: 'default' },
        explore: { module: './boot/explore.generated.json', export: 'default' } },
      sword: { platform: 'graph', file: 'weapons/jian-row.json' }, forestQueries: { platform: 'fixed', density: 0 } } }));
    const source = authoredManifestSource(scratch, fixture.slug, { metadataOnly: true, composed: data });
    expect(source).toContain('"./boot/files.generated.json"');
    expect(source).toContain('"./boot/sources.generated.json"');
    expect(source).toContain('"./boot/explore.generated.json"');
    expect(source).toContain('from "./explore/fixed-binding.svg"');
    expect(source).toContain(JSON.stringify(art));
    expect(source).toContain('HeldView.fromProduct("_template", "weapons/jian-row.json")).sword()');
    expect(source).toContain('declaredForestQueries({"platform":"fixed","density":0})');
    expect(source).not.toContain('pageModeBoot');
    const queries = declaredForestQueries({ platform: 'fixed', density: 0 });
    expect(queries.density(10, -10)).toBe(0);
    expect(Object.keys(queries)).toEqual(['density']);
    for (const bad of [{ platform: 'fixed', density: -1 }, { platform: 'fixed', density: 2 },
      { platform: 'fixed', density: 0, scale: 2 }]) expect(() => declaredForestQueries(bad)).toThrow();
  } finally { rmSync(scratch, { recursive: true }); }
});

test('declared forest rows join the manifest intake instead of decoding during discovery', () => {
  const data = parseManifestMetadata(metadata({ bindings: { ...bindings, entry,
    forestQueries: { platform: 'declared', rows: { module: './data/forest.generated.json', export: 'default' } } } }));
  const source = authoredManifestSource(root, fixture.slug, { metadataOnly: true, composed: data });
  expect(source).toMatch(/forestRows: binding\d+/u);
  expect(source).toContain('from "./data/forest.generated.json"');
  expect(source).not.toContain('declaredForestQueries');
});

test('the default JSON art binding contributes extra source image imports and refuses invalid paths', () => {
  const scratch = mkdtempSync(resolve(root, 'tmp/manifest-extra-art-'));
  const folder = resolve(scratch, 'src/shards/_template/boot');
  mkdirSync(folder, { recursive: true });
  mkdirSync(resolve(folder, '../data'), { recursive: true });
  writeFileSync(resolve(folder, '../data/budgets.json'), readFileSync(resolve(root, 'src/shards/_template/data/budgets.json')));
  const file = resolve(folder, 'explore.generated.json');
  const extra = '/src/shards/_template/explore/additional.webp';
  const data = parseManifestMetadata({ ...fixture, bindings: { ...bindings,
    boot: { files: { module: './boot/files.generated.json', export: 'default' },
      sources: { module: './boot/sources.generated.json', export: 'default' },
      explore: { module: './boot/explore.generated.json', export: 'default' } } } });
  const compile = (): string => authoredManifestSource(scratch, fixture.slug, { metadataOnly: true, composed: data });
  try {
    writeFileSync(file, JSON.stringify({ art: [extra, extra] }));
    const source = compile();
    expect(source).toContain('from "./explore/additional.webp"');
    expect(source).toContain(JSON.stringify(extra));
    for (const art of [['/src/shards/other-shard/extra.webp'], ['/src/shards/_template/../escape.webp'], ['https://example.com/image.webp']]) {
      writeFileSync(file, JSON.stringify({ art }));
      expect(compile).toThrow();
    }
    const boot = data.bindings.boot;
    if (boot === undefined || 'platform' in boot) throw new Error('Fixture requires fixed boot');
    for (const explore of [{ module: './boot/explore.ts', export: 'default' }, { module: './boot/explore.json', export: 'named' }]) {
      expect(() => parseManifestMetadata({ ...data, bindings: { ...data.bindings, boot: { ...boot, explore } } })).toThrow();
    }
  } finally { rmSync(scratch, { recursive: true }); }
});

test('only the attackers sentinel becomes infinity and complete art order survives', () => {
  const boot = { precache: [], barrier: true, phone: { deferExtras: true, fragile: true, trace: true }, cullBeforeFirstDraw: true };
  const data = parseManifestMetadata({ ...fixture, boot, fight: { attackers: 'unbounded' } });
  const images: Record<string, string> = {};
  for (const path of [...Object.values(data.card), ...Object.values(data.explore.art), data.minimap.image,
    ...(data.explore.compare?.flatMap(row => [row.live, row.image]) ?? [])]) if (path.startsWith('/src/')) images[path] = path;
  const art = [...Object.values(data.explore.art), '/assets/extra.webp', '/assets/extra.webp'];
  const files = ['/assets/original.glb', '/assets/original.glb'];
  const chunk = { sky: [], baked: [], terrain: [], trees: [], cabins: [], physics: ['/assets/physics/rapier.wasm'], props: files, art: [], music: [], sfx: [] };
  const sources = { modes: { phone: { img: chunk, ktx2: chunk }, desktop: { img: chunk, ktx2: chunk } } };
  const ground = { ...declaredGround({ terrain: { flat: 0, seed: 40234 }, trails: [], cabinSites: [], water: -1000, bodies: [] }), structures: true as const, paths: 'plugin' as const };
  const manifest = defineAuthoredShard(data, '_template', { accent: 'pink', bootBindings: { files, sources, explore: { art } } },
    { ground }, images);
  expect(manifest.fight?.attackers).toBe(Infinity);
  expect(manifest.boot?.explore?.art).toEqual(art);
  const level = toLevelSpec(manifest);
  expect(level.ground.structures).toBe(true); expect(level.ground.paths).toBe('plugin');
  expect(level.ground.terrain).toBe(ground.terrain);
  expect(level.boot).toEqual({ ...boot, files, sources, explore: { art } });
  expect(level.fight.attackers).toBe(Infinity);
  for (const fight of [{ attackers: null }, { attackers: Infinity }, { maxHitDamage: 'unbounded' }]) {
    expect(() => parseManifestMetadata({ ...fixture, fight })).toThrow();
  }
});
