// oxlint-disable-next-line import/no-nodejs-modules -- This test bakes a build folder of its own from a real cook.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test bakes a build folder of its own from a real cook.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test bakes a build folder of its own from a real cook.
import {dirname, join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {addCookedShards} from '../src/scripts/app-build/catalogue';
import {stampBuildHtml} from '../src/scripts/app-build/buildIdentity.mjs';
import {indexKey, type CookIndex} from '../src/cook/game/cookWorker';
import {packsBookPath} from '../src/shared/game/shardfile/spawnManifest';
import type {TitleManifest} from '../src/client/game/shard/titleList';
import {hashOf, slug, useCookHarness} from './fixtures/cookWorkerHarness';

/**
 * SHARD-COMPAT NB8 (meta NEVER-BREAK-LIVE I4): a path move ships its reader first. `4de1e703e` moved a stored cook's
 * shardfiles under `loose/<upload>/`; the title row still named the old path and a cold cook-to-play 404'd
 * `shardfiles/brasscap-mesa/discovery.json`, which only the post-main browser gate saw. Here the real cook worker writes
 * the store and the real bake (`addCookedShards`, as `addStoredShards` calls it) writes the title row; every URL the row
 * names must be a key the cook published and the store holds. Moving the writer's paths without the reader goes red here,
 * in node, in the push gate's related tests for either side.
 */
describe('the cook writer and the title reader agree on paths', () => {
  const h = useCookHarness();
  const BASE = 'https://packs.example/';

  it('every URL a stored cook\'s title row names is a key its cook published', async () => {
    const hash = hashOf(h.real), cook = h.worker(new Map([[hash, h.real]]));
    expect((await cook.cook({slug, hash})).state).toBe('cooked');
    const read = async (key: string): Promise<Uint8Array> => {
      const body = await h.store.get(key);
      if (body === undefined) throw new Error(`The store has no ${key}`);
      return body;
    };
    const index = JSON.parse(new TextDecoder().decode(await read(indexKey('b1', hash)))) as CookIndex;
    const loose = index.loose ?? '';
    const out = mkdtempSync(join(tmpdir(), 'cook-read-contract-'));
    try {
      // The bake's own steps for a stored cook (src/scripts/app-build/catalogue.ts addStoredShards): the manifests beside the
      // build, the discovery document from the cook's upload folder, and the home that names that folder.
      for (const row of index.manifests) {
        mkdirSync(dirname(join(out, row.url)), {recursive: true});
        writeFileSync(join(out, row.url), await read(row.url.slice(1)));
      }
      writeFileSync(join(out, 'version.json'), JSON.stringify({build: 'b1'}));
      writeFileSync(join(out, packsBookPath('b1')), JSON.stringify({book: 'packs', build: 'b1', client: {}}));
      writeFileSync(join(out, 'index.html'), stampBuildHtml('<head><script type="application/json" id="boot-module-files">{"spawnManifests":{"client":{}}}</script></head>', 'b1',
        {validator: 'a'.repeat(64), verdicts: [], world: {release: 'r', key: 'k', recordTag: 't'}, label: 'staging'}));
      const discovery = await read(`${loose}shardfiles/${slug}/discovery.json`);
      addCookedShards(out, [{slug, hash, header: index.header, verdict: {path: `/shardfiles/${slug}/shard.json`}, discovery, manifests: index.manifests}], out,
        {base: BASE, shards: [slug], ...(loose === '' ? {} : {loose: {[slug]: loose}})});
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      const rows = JSON.parse(/id="ws-title-rows">([^<]*)<\/script>/u.exec(html)?.[1] ?? '[]') as TitleManifest[];
      const row = rows.find(entry => entry.slug === slug);
      expect(row, 'the stored cook has a title row').toBeDefined();
      const named = [row?.shardfile, row?.discovery, row?.card.thumb].filter((url): url is string => typeof url === 'string' && url.startsWith(BASE));
      expect(named.length, 'the row names the shardfile, its discovery and its thumb on the pack base').toBe(3);
      for (const url of named) {
        const key = decodeURIComponent(new URL(url).pathname.slice(1));
        expect(index.keys, `${url} is a key the cook published`).toContain(key);
        expect(await h.store.has(key), `${url} is in the store`).toBe(true);
      }
    } finally { rmSync(out, {recursive: true, force: true}); }
  }, 180_000);
});
