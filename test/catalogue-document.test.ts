// oxlint-disable-next-line import/no-nodejs-modules -- This test bakes a build folder of its own.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test bakes a build folder of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test bakes a build folder of its own.
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import * as v from 'valibot';
import {packsBookPath} from '../src/shared/game/shardfile/spawnManifest';
import {StandaloneCatalogueSchema} from '@wildshard/format/standaloneCatalogue';
import {addCookedShards, catalogueWithAdded, writeCatalogueDocument} from '../scripts/app-build/catalogue';
import {refreshServiceWorker, workerScripts} from '../scripts/app-build/serviceWorker';
import {installTitleManifests, titleManifests, withCatalogueHeads, type TitleManifest} from '../src/client/game/shard/titleList';
import {GridAssembly} from '../src/shared/game/grid/assembly';
import {catalogueDocument} from '../src/shared/game/grid/catalogueDocument';
import {installCatalogue, installInlineCatalogue, installedCatalogue} from '../src/shared/game/grid/catalogueSlot';
import {firstPartyInstance} from '../src/shared/game/grid/instances';
import shipped from '../src/shared/game/grid/singleplayer.json' with {type: 'json'};
import {instanceSaveIdentity} from '../src/shared/game/instanceSaves';
import {assertExternalShardSlug} from '../src/shared/game/shardfile/identity';

/** C3 (J61, D7): what a page reads at boot, and a shard added to it after the build. */
const fresh = {slug: 'test-shard', name: 'Test Shard', revision: 1, hash: 'a'.repeat(64)};
const added = {...shipped, placements: [...shipped.placements, {instance: 'test-shard-solo', slug: 'test-shard', cell: [9, 9], size: [500, 500, 500], order: 99}],
  grid: {...shipped.grid, cells: shipped.grid.cells.map(row => (row.cell[0] === 2 && row.cell[1] === 2 ? {instance: 'test-shard', slug: 'test-shard', cell: row.cell} : row))}, shards: [fresh]};
const card = {thumb: 'a', portrait: 'b', landscape: 'c'};
const title = (slug: string): TitleManifest => ({slug, name: slug, biome: '', status: 'live', card});

describe('the catalogue a page reads', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });

  it('reads the shipped grid until a root installs one', () => {
    expect(installedCatalogue()).toBeUndefined();
    expect(catalogueDocument()).toBe(shipped);
    installCatalogue(added);
    expect(catalogueDocument()).toBe(added);
  });

  it('refuses what is no catalogue', () => {
    for (const value of [null, 1, {}, {placements: []}, {placements: [], grid: {}}]) expect(() => { installCatalogue(value); }).toThrow('Invalid catalogue');
  });

  it('takes the copy the document inlines, and a page with none keeps the default', () => {
    installInlineCatalogue({getElementById: () => null});
    expect(installedCatalogue()).toBeUndefined();
    const element = {textContent: JSON.stringify(added)} as HTMLElement;
    installInlineCatalogue({getElementById: () => element});
    expect(catalogueDocument().shards).toEqual([fresh]);
  });

  it('runs a new placement through every reader', () => {
    installCatalogue(added);
    expect(new GridAssembly({developer: false, devserver: false}).cell('test-shard').slug).toBe('test-shard');
    expect(firstPartyInstance('test-shard')).toBe('test-shard-solo');
    expect(instanceSaveIdentity({id: 'test-shard-solo', shard: 'test-shard'})).toEqual({id: 'test-shard-solo', legacy: 'test-shard'});
    // Placed by the catalogue, so an outside product can't take its slug or saves.
    expect(() => { assertExternalShardSlug('test-shard'); }).toThrow('reserved');
  });

  it('lists a placed head the build has no card for, and only that', () => {
    const rows = [title('driftwood-isle'), title('_template')];
    expect(withCatalogueHeads(rows)).toBe(rows);
    installCatalogue({...added, shards: [{...fresh, slug: 'template'}, {...fresh, slug: 'driftwood-isle'}, {...fresh, slug: 'unplaced'}, fresh]});
    const listed = withCatalogueHeads(rows);
    expect(listed.map(row => row.slug)).toEqual(['driftwood-isle', '_template', 'test-shard']);
    expect(listed[2]).toMatchObject({name: 'Test Shard', order: 99, shardfile: '/shardfiles/test-shard/shard.json'});
    installTitleManifests(listed);
    expect(titleManifests()).toBe(listed);
  });
});

describe('the bake', () => {
  const document_ = {version: 0, stage: 'live', placements: [{instance: 'a-solo', slug: 'a', cell: [0, 0], size: [500, 500, 500]}],
    grid: shipped.grid, shards: [{...fresh, name: '</script><b>'}], missing: []};
  const folder = (): string => mkdtempSync(join(tmpdir(), 'catalogue-'));

  it('writes the file and inlines it, once, and no `<` closes the element', () => {
    const out = folder();
    try {
      writeFileSync(join(out, 'index.html'), '<html><head></head><body></body></html>');
      writeCatalogueDocument(out, document_);
      writeCatalogueDocument(out, document_);
      const html = readFileSync(join(out, 'index.html'), 'utf8'), body = /id="ws-catalogue">([^<]*)<\/script>/u.exec(html)?.[1] ?? '';
      expect(html.match(/ws-catalogue/gu)).toHaveLength(1);
      const baked: unknown = JSON.parse(readFileSync(join(out, 'catalogue.json'), 'utf8')), inlined: unknown = JSON.parse(body);
      expect(v.parse(StandaloneCatalogueSchema, baked).shards[0]?.name).toBe('</script><b>');
      expect(inlined).toEqual(baked);
    } finally { rmSync(out, {recursive: true, force: true}); }
  });

  it('adds a stored head by the deploy\'s rows, and leaves what the build shipped', () => {
    const row = {slug: 'driftwood-isle', name: 'Driftwood Isle', revision: 1, hash: 'b'.repeat(64)};
    const built = {version: 0, stage: 'live', placements: shipped.placements, grid: shipped.grid, shards: [row], missing: []} as unknown as Parameters<typeof catalogueWithAdded>[0];
    const live = {...built, placements: [...shipped.placements.map(place => ({...place, order: 7})), added.placements.at(-1)], shards: [{...row, revision: 9}, fresh]} as typeof built;
    const merged = catalogueWithAdded(built, live, ['test-shard']);
    expect(merged.shards).toEqual([row, fresh]);
    expect(merged.grid).toBe(shipped.grid);
    expect(merged.placements.slice(0, -1)).toEqual(shipped.placements);
    expect(merged.placements.at(-1)?.slug).toBe('test-shard');
    expect(() => catalogueWithAdded(built, built, ['test-shard'])).toThrow('no row for test-shard');
  });

  it('refreshes the worker\'s page and id with no bundler manifest', () => {
    const out = mkdtempSync(join(tmpdir(), 'bake-worker-'));
    try {
      const before = '<html>one</html>', core = `const BUILD = 'b-1-0123456789';\nconst DOCUMENT = ${JSON.stringify(before)};\n`, {fileName, bootstrap} = workerScripts(core);
      mkdirSync(join(out, 'sw-core'));
      writeFileSync(join(out, fileName), core); writeFileSync(join(out, 'sw.js'), bootstrap);
      writeFileSync(join(out, 'version.json'), '{"build":"b-1"}'); writeFileSync(join(out, 'index.html'), '<html>two</html>');
      refreshServiceWorker(out, before);
      const next = readFileSync(join(out, /"\/(sw-core\/[a-f0-9]+\.js)"/u.exec(readFileSync(join(out, 'sw.js'), 'utf8'))?.[1] ?? ''), 'utf8');
      expect(next).toContain('<html>two</html>');
      expect(next).not.toContain('0123456789');
      expect(next).toMatch(/const BUILD = 'b-1-[a-f0-9]{10}'/u);
      expect(() => { refreshServiceWorker(out, before); }).toThrow('another page');
    } finally { rmSync(out, {recursive: true, force: true}); }
  });

  it('names a cooked shard in the tables a page reads', () => {
    const out = folder();
    try {
      const manifest = {version: 1, shard: 'test-shard', tier: 'phone', flow: 'client', files: [], totalBytes: 0, wireBytes: 0};
      mkdirSync(join(out, 'assets/spawn'), {recursive: true});
      writeFileSync(join(out, 'version.json'), JSON.stringify({build: 'build-1'}));
      writeFileSync(join(out, 'assets/spawn/entry.json'), JSON.stringify(manifest));
      writeFileSync(join(out, 'assets/spawn/whole.json'), JSON.stringify(manifest));
      const book = join(out, packsBookPath('build-1'));
      writeFileSync(book, JSON.stringify({book: 'packs', build: 'build-1', client: {}}));
      const verdict = (slug: string): unknown => ({path: `/shardfiles/${slug}/shard.json`});
      writeFileSync(join(out, 'index.html'), `<head><script>globalThis.__WS_SHARDFILE_VERDICTS__=${JSON.stringify([verdict('a')])};</script><script type="application/json" id="boot-module-files">{"spawnManifests":{"client":{}}}</script></head>`);
      const row = (url: string, set: 'entry' | 'whole'): {url: string; tier: 'phone'; set: 'entry' | 'whole'; files: number; totalBytes: number; wireBytes: number} => ({url, tier: 'phone', set, files: 0, totalBytes: 0, wireBytes: 0});
      addCookedShards(out, [{slug: 'test-shard', hash: fresh.hash, header: '', verdict: verdict('test-shard'), manifests: [row('/assets/spawn/entry.json', 'entry'), row('/assets/spawn/whole.json', 'whole')]}]);
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      expect(html).toContain('"spawnManifests":{"client":{"test-shard":{"phone":{"url":"/assets/spawn/entry.json"');
      expect(html).toContain('__WS_SHARDFILE_VERDICTS__=[{"path":"/shardfiles/a/shard.json"},{"path":"/shardfiles/test-shard/shard.json"}]');
      expect(JSON.parse(readFileSync(book, 'utf8'))).toMatchObject({client: {'test-shard': {phone: {url: '/assets/spawn/whole.json'}}}});
    } finally { rmSync(out, {recursive: true, force: true}); }
  });
});
