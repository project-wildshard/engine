// Standalone shardfiles SF11: no pin copies a zone's mounts under public/, so the build's sfx tables list only engine-wide
// sets. A zone's own set (its cue bank and its credit, the open plots' `/assets/<slug>/sfx/<set>/sfx.json`) joins them from
// the zone's verified parts, as its own score does (SF23); without it level.play refused "Scene cue bank requires its credit".
import {expect, test, vi} from 'vitest';
import {cueManifest} from '../src/shared/engine/audio/bootAudio';
import {installAssetTables, publicBytes, sfxManifests} from '../src/shared/engine/boot/tables';
import {ZONE_DIR} from '../src/shared/engine/boot/zoneAssets';

const dir = '/assets/open-plot-example/sfx/example/';
const manifest = {credit: 'made-up recordings', provenance: 'not shipped', beds: {road: 'road-0123456789ab.m4a'}};
const held = new Map<string, Uint8Array>([[`${dir}sfx.json`, new TextEncoder().encode(JSON.stringify(manifest))]]);
const sizes = new Map<string, number>([[`${dir}sfx.json`, held.get(`${dir}sfx.json`)?.length ?? 0], [`${dir}road-0123456789ab.m4a`, 42]]);
vi.mock('../src/client/game/boot/spawnDownload', () => ({
  spawnMountSize: (url: string) => Promise.resolve(sizes.get(url)),
  spawnHeldBytes: (url: string) => Promise.resolve(held.get(url)?.slice().buffer ?? null),
}));

test("a zone's own sfx set joins the tables from its parts, with its credit and its recordings' sizes", async () => {
  const {adoptCookedSfx} = await import('../src/client/game/shardfile/audioCatalogue');
  installAssetTables({music: {}, sfx: {engine: {credit: 'engine'}}, bytes: {}, versions: {}, packs: {}});
  expect(cueManifest('example')).toBeUndefined();
  await adoptCookedSfx('open-plot-example', 'example');
  expect(cueManifest('example')).toEqual({credit: 'made-up recordings', beds: manifest.beds, [ZONE_DIR]: dir});
  expect(sfxManifests()['engine']).toEqual({credit: 'engine'});
  expect(publicBytes()[`${dir}road-0123456789ab.m4a`]).toBe(42);
  // the zone's parts copy wins over a baked one (a cold cook's head), and a zone with no such mount adds nothing
  installAssetTables({music: {}, sfx: {example: {credit: 'baked'}}, bytes: {}, versions: {}, packs: {}});
  await adoptCookedSfx('open-plot-example', 'example');
  expect(cueManifest('example')?.['credit']).toBe('made-up recordings');
  installAssetTables({music: {}, sfx: {}, bytes: {}, versions: {}, packs: {}});
  await adoptCookedSfx('open-plot-other', 'other');
  expect(sfxManifests()).toEqual({});
});
