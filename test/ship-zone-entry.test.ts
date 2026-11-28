// @vitest-environment node
// Standalone shardfiles SF14 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md): the ship proof's
// verdict. `src/scripts/ship-zone-entry.mjs` enters every zone a deployed page's zone table names and fails on page-origin zone
// art; these cases pin what counts as zone art and what the page may serve itself.
import {describe, expect, it} from 'vitest';
import {tableZones, tierFailure, tierReads, zoneArtFromPage} from '../src/scripts/ship-zone-entry.mjs';

const engine = new Set(['assets/hdri/sky.webp', 'assets/models/hatchet.glb', 'assets/baked/common/cloud-field.bin']);
const known = {engine, zones: ['pine-hollow', 'sunscar-dunes']};

describe('SF14: zone art from the page', () => {
  it('counts a zone-named path, a shardfile and an art file off the engine list', () => {
    expect(zoneArtFromPage('/assets/pine-hollow/tex/bark.ktx2', known)).toBe(true);
    expect(zoneArtFromPage('/assets/gpu/models/driftwood-blender/lm-ao-880aa796.ktx2', known)).toBe(true);
    expect(zoneArtFromPage('/shardfiles/sunscar-dunes/discovery.json', known)).toBe(true);
    expect(zoneArtFromPage('/programs/sunscar-dunes.json', known)).toBe(true);
  });

  it('lets the page serve engine art (fingerprinted or not), the title art, the runtime and its own shell', () => {
    expect(zoneArtFromPage('/assets/hdri/sky.webp', known)).toBe(false);
    expect(zoneArtFromPage('/assets/hdri/sky-0123456789abcdef.webp', known)).toBe(false);
    expect(zoneArtFromPage('/assets/baked/common/cloud-field.bin', known)).toBe(false);
    expect(zoneArtFromPage('/assets/title/launch-1206x2622-aa16bc3256f3.png', known)).toBe(false);
    expect(zoneArtFromPage('/assets/physics/rapier.wasm', known)).toBe(false);
    expect(zoneArtFromPage('/assets/spawn/common-client-phone-0123456789abcdef.json', known)).toBe(false);
    expect(zoneArtFromPage('/index.html', known)).toBe(false);
    expect(zoneArtFromPage('/zone-table.json', known)).toBe(false);
    // v0.1.101's staging SF14: the engine's boot tables and road seam plans are the build's own (PV6)
    expect(zoneArtFromPage('/assets/boot-tables-4101cd17.json', known)).toBe(false);
    expect(zoneArtFromPage('/assets/grid-seam-plans-aced7c9a.json', known)).toBe(false);
    expect(zoneArtFromPage('/assets/boot-tables-pine-hollow.json', known)).toBe(true);
  });
});

describe('SF14: a tier\'s reads', () => {
  it('splits reads by origin and names zone art the page answered, not what it refused', () => {
    const reads = [
      {url: 'https://staging.wildshard.io/index.html', status: 200},
      {url: 'https://staging.wildshard.io/assets/hdri/sky.webp', status: 200},
      {url: 'https://staging.wildshard.io/assets/pine-hollow/tex/bark.ktx2', status: 200},
      {url: 'https://staging.wildshard.io/assets/sunscar-dunes/sand.png', status: 404},
      {url: 'https://cooked.wildshard.io/shards/pine-hollow/0.5.22/cooks/1.11.0/abc/index.json', status: 200},
    ];
    expect(tierReads(reads, {page: 'https://staging.wildshard.io', cook: 'https://cooked.wildshard.io/', zone: 'pine-hollow', ...known})).toEqual({
      requests: 5, fromCook: 1, zoneFromCook: 1, fromPage: 4, zoneFromPage: ['/assets/pine-hollow/tex/bark.ktx2'],
      missing: ['https://staging.wildshard.io/assets/sunscar-dunes/sand.png'],
    });
  });
});

describe('SF14: a tier passes only on its zone read from the cook', () => {
  const cook = 'https://cooked.wildshard.io/', page = 'https://staging.wildshard.io';
  const where = {page, cook, zone: 'pine-hollow', ...known};

  it('fails a tier that entered with no read of its zone from the cook', () => {
    const none = tierReads([{url: `${page}/index.html`, status: 200}], where);
    expect(none.zoneFromCook).toBe(0);
    expect(tierFailure({gameplayMs: 5000, ...none})).toBe('no read of the zone from the cook');
    // Another zone's parts, or a refused read of this one, are not this zone's cook read.
    const other = tierReads([{url: `${cook}shards/sunscar-dunes/0.0.9/cooks/1.11.0/abc/index.json`, status: 200},
      {url: `${cook}shards/pine-hollow/0.5.22/cooks/1.11.0/abc/index.json`, status: 404}], where);
    expect(tierFailure({gameplayMs: 5000, ...other})).toBe('no read of the zone from the cook');
  });

  it('passes a tier with gameplay, a zone read from the cook and no zone art from the page', () => {
    const good = tierReads([{url: `${cook}shards/pine-hollow/0.5.22/cooks/1.11.0/abc/client/phone-0.pack.br`, status: 200}], where);
    expect(tierFailure({gameplayMs: 5000, ...good})).toBeUndefined();
    expect(tierFailure({gameplayMs: null, ...good})).toBe('no gameplay');
    expect(tierFailure({gameplayMs: 5000, ...good, zoneFromPage: ['/assets/pine-hollow/x.png']})).toMatch(/^zone art from the page/u);
  });
});

describe('SF14: the page\'s zone table', () => {
  it('names its zones and the cook origin, cooked.wildshard.io by default', () => {
    expect(tableZones({version: 1, zones: [{slug: 'pine-hollow'}, {slug: 'sunscar-dunes'}]})).toEqual({origin: 'https://cooked.wildshard.io/', zones: ['pine-hollow', 'sunscar-dunes']});
    expect(tableZones({version: 1, origin: 'http://127.0.0.1:9000/', zones: [{slug: 'pine-hollow'}]}).origin).toBe('http://127.0.0.1:9000/');
  });

  it('refuses a page that is not zone-free yet', () => {
    expect(() => tableZones(null)).toThrow(/not zone-free/u);
    expect(() => tableZones({version: 1, zones: []})).toThrow(/not zone-free/u);
    expect(() => tableZones({version: 1, zones: [{slug: '../x'}]})).toThrow(/no slug/u);
  });
});
