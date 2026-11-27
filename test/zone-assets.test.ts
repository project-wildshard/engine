// SF4 (meta standalone shardfiles): a re-packed zone keeps its art under its own name, /assets/<slug>/…, and the engine's
// audio readers find a zone's music and sfx folders through the audio tables (their `$dir`), the engine-wide folder second.
// oxlint-disable-next-line import/no-nodejs-modules -- A fixture public/ tree for the build's audio table.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ZONE_DIR, audioDirOf, audioManifestRow, bakedFile, hdriStem, isAudioUrl, texBase, useZoneDownloadListing, zoneAssetUrl, zoneFileListed, zoneFirst, zoneFolderFirst } from '../src/shared/engine/boot/zoneAssets';
import { navmeshUrl } from '../src/shared/engine/physics/navmeshUrl';
import { bakedTerrainUrl } from '../src/shared/engine/world/BakedTerrain';
import { lutUrl } from '../src/client/engine/world/lut';
import { bakedNearFiles } from '../src/client/game/grid/nearPlaceholderView';
import { filePolicy } from '../src/client/engine/boot/filePolicy';
import { bakedSkyUrls } from '../src/client/engine/world/BakedSky';
import { musicDir, sfxDir, cueFile } from '../src/shared/engine/audio/bootAudio';
import { withAssetTables } from '../src/shared/engine/boot/tables';
import { audioTableSource } from '../src/scripts/app-build/gen';
import { isAudioUrl as isCookAudio } from '../src/cook/game/audioReport';

test('a zone asset URL is the slug in front of a confined path', () => {
  expect(zoneAssetUrl('open-plot-alien-plain', 'music/alien-plain/music.json')).toBe('/assets/open-plot-alien-plain/music/alien-plain/music.json');
  for (const rest of ['', '/x', 'a/../b', 'a//b', './a']) expect(() => zoneAssetUrl('nalati-grasslands', rest)).toThrow('Not a zone asset path');
  for (const slug of ['Nalati', 'a--b', '-a', '']) expect(() => zoneAssetUrl(slug, 'x.jpg')).toThrow('Not a zone slug');
});

test('an audio manifest URL names its table key, and a zone one its folder', () => {
  expect(audioManifestRow('/assets/music/piano/music.json')).toEqual({ kind: 'music', key: 'piano' });
  expect(audioManifestRow('/assets/sfx/best/sfx.json')).toEqual({ kind: 'sfx', key: 'best' });
  expect(audioManifestRow('/assets/open-plot-alien-plain/sfx/alien-plain/sfx.json'))
    .toEqual({ kind: 'sfx', key: 'alien-plain', dir: '/assets/open-plot-alien-plain/sfx/alien-plain/' });
  for (const url of ['/assets/music/piano/sfx.json', '/assets/x/music/piano/x.json', '/assets/a/b/music/k/music.json', '/assets/music/k/music.json?v=1'])
    expect(audioManifestRow(url)).toBeNull();
});

test('boot audio paths: engine-wide and zone folders, nothing else', () => {
  expect(isAudioUrl('/assets/music/piano/title-7ce82663.m4a')).toBe('music');
  expect(isAudioUrl('/assets/sunscar-dunes/sfx/sunscar-dunes/wind.m4a')).toBe('sfx');
  expect(isAudioUrl('/assets/sunscar-dunes/models/x.glb')).toBeNull();
  expect(isCookAudio('/assets/open-plot-sky-race/music/sky-race/take-a-1.m4a')).toBe(true);
  expect(isCookAudio('/assets/open-plot-sky-race/models/a.m4a')).toBe(false);
});

const TABLES = { bytes: { '/assets/open-plot-alien-plain/sfx/alien-plain/bed-1.m4a': 3, '/assets/sfx/best/hit.m4a': 2 }, versions: {}, packs: {},
  music: { 'alien-plain': { style: 'alien-plain', [ZONE_DIR]: '/assets/open-plot-alien-plain/music/alien-plain/' }, piano: { style: 'piano' } },
  sfx: { 'alien-plain': { beds: {}, [ZONE_DIR]: '/assets/open-plot-alien-plain/sfx/alien-plain/' }, best: {} } };

test('music and sfx folders come from the table: the zone folder first, the engine-wide one second', () => withAssetTables(TABLES, () => {
  expect(musicDir('alien-plain')).toBe('/assets/open-plot-alien-plain/music/alien-plain/');
  expect(musicDir('piano')).toBe('/assets/music/piano/');
  expect(sfxDir('alien-plain')).toBe('/assets/open-plot-alien-plain/sfx/alien-plain/');
  expect(sfxDir('best')).toBe('/assets/sfx/best/');
  expect(cueFile('alien-plain', 'bed-1.m4a')).toBe('/assets/open-plot-alien-plain/sfx/alien-plain/bed-1.m4a');
  expect(cueFile('best', 'hit.m4a')).toBe('/assets/sfx/best/hit.m4a');
  // a folder that is not a zone audio folder is never trusted
  expect(audioDirOf({ [ZONE_DIR]: '/assets/elsewhere/' }, '/assets/sfx/x/')).toBe('/assets/sfx/x/');
}));

test('the build table reads zone audio folders and refuses one key in two places', () => {
  const root = mkdtempSync(join(process.cwd(), 'tmp/zone-audio-'));
  try {
    const put = (path: string, body: unknown): void => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), JSON.stringify(body)); };
    put('public/assets/music/piano/music.json', { style: 'piano', provenance: [1] });
    put('public/assets/open-plot-alien-plain/music/alien-plain/music.json', { style: 'alien-plain', synth_keeps: 1 });
    put('public/assets/open-plot-alien-plain/sfx/alien-plain/sfx.json', { beds: {} });
    const source = audioTableSource(root);
    expect(source).toContain('"piano": {\n  "style": "piano"\n }');
    expect(source).toContain('"$dir": "/assets/open-plot-alien-plain/music/alien-plain/"');
    expect(source).toContain('"$dir": "/assets/open-plot-alien-plain/sfx/alien-plain/"');
    expect(source).not.toContain('synth_keeps');
    put('public/assets/sfx/alien-plain/sfx.json', { beds: {} });
    expect(() => audioTableSource(root)).toThrow("a second sfx manifest for 'alien-plain'");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// SF4 slice 2: the baked readers (terrain, navmesh, sky, near and far views, baked textures, the LUT) read a zone's own
// /assets/<slug>/baked/ copy when the page's byte table lists it, the engine-wide /assets/baked/<slug>/ copy otherwise.
const BAKED = { versions: {}, packs: {}, music: {}, sfx: {}, bytes: {
  '/assets/sunscar-dunes/baked/terrain.bin': 1, '/assets/sunscar-dunes/baked/navmesh.bin': 1, '/assets/sunscar-dunes/baked/tex/sand.png': 1,
  '/assets/sunscar-dunes/lut.bin': 1, '/assets/baked/far-reach/terrain.bin': 1, '/assets/baked/far-reach/navmesh.bin': 1, '/assets/lut/far-reach.bin': 1 } };

test('baked files: the zone copy first, the engine-wide copy second', () => withAssetTables(BAKED, () => {
  expect(bakedFile('sunscar-dunes', 'terrain.bin')).toBe('/assets/sunscar-dunes/baked/terrain.bin');
  expect(bakedFile('far-reach', 'terrain.bin')).toBe('/assets/baked/far-reach/terrain.bin');
  expect(bakedFile('sunscar-dunes', 'sky.json')).toBe('/assets/baked/sunscar-dunes/sky.json');
  expect(bakedTerrainUrl('sunscar-dunes')).toBe('/assets/sunscar-dunes/baked/terrain.bin');
  expect(bakedTerrainUrl('far-reach')).toBe('/assets/baked/far-reach/terrain.bin');
  expect(navmeshUrl('sunscar-dunes')).toBe('/assets/sunscar-dunes/baked/navmesh.bin');
  expect(navmeshUrl('nalati-grasslands')).toBeNull();
  expect(lutUrl('sunscar-dunes')).toBe('/assets/sunscar-dunes/lut.bin');
  expect(lutUrl('far-reach')).toBe('/assets/lut/far-reach.bin');
  expect(zoneFolderFirst('sunscar-dunes', 'baked/tex', '/assets/baked/sunscar-dunes/tex/')).toBe('/assets/sunscar-dunes/baked/tex/');
  expect(zoneFolderFirst('far-reach', 'baked/tex', '/assets/baked/far-reach/tex/')).toBe('/assets/baked/far-reach/tex/');
  // a name that is no slug never builds a zone path
  expect(zoneFirst('../x', 'baked/terrain.bin', '/assets/baked/x/terrain.bin')).toBe('/assets/baked/x/terrain.bin');
}));

// SF4: Far Reach entered from a local cook read its far view from the page's engine-wide copy; the cook's download lists
// the zone's own, and that one wins.
test("a cooked zone's download listing wins over the page's engine-wide copy", () => withAssetTables({ ...BAKED, bytes: {
  ...BAKED.bytes, '/assets/baked/far-reach/far.glb': 1 } }, () => {
  expect(bakedFile('far-reach', 'far.glb')).toBe('/assets/baked/far-reach/far.glb');
  useZoneDownloadListing(url => url === '/assets/far-reach/baked/far.glb');
  try {
    expect(bakedFile('far-reach', 'far.glb')).toBe('/assets/far-reach/baked/far.glb');
    expect(zoneFileListed('/assets/far-reach/baked/far.glb')).toBe(true);
    expect(bakedFile('far-reach', 'far.json')).toBe('/assets/baked/far-reach/far.json');
    expect(zoneFileListed('/assets/baked/far-reach/far.json')).toBe(false);
  } finally { useZoneDownloadListing(() => false); }
  expect(bakedFile('far-reach', 'far.glb')).toBe('/assets/baked/far-reach/far.glb');
}));

test('a near view reads the zone baked folder first', () => {
  expect(bakedNearFiles('sunscar-dunes', { '/assets/sunscar-dunes/baked/near.json': 1, '/assets/sunscar-dunes/baked/near.glb': 2 }))
    .toEqual({ row: '/assets/sunscar-dunes/baked/near.json', mesh: '/assets/sunscar-dunes/baked/near.glb' });
  expect(bakedNearFiles('far-reach', { '/assets/baked/far-reach/near.json': 1, '/assets/baked/far-reach/near.glb': 2 }))
    .toEqual({ row: '/assets/baked/far-reach/near.json', mesh: '/assets/baked/far-reach/near.glb' });
  expect(bakedNearFiles('far-reach', {})).toBeNull();
});

// SF4 slice 3: a zone names its own ground layers and sky by URL (`/assets/<slug>/tex/<id>`, `/assets/<slug>/hdri/<name>`);
// a bare id or name is still the engine-wide set, so a zone not yet re-packed reads what it read before.
test('ground layers and skies: a URL is the zone copy, a bare name the engine-wide one', () => {
  expect(texBase('/assets/nalati-grasslands/tex/leafy_grass', 'diffuse')).toBe('/assets/nalati-grasslands/tex/leafy_grass/diffuse');
  expect(texBase('leafy_grass', 'arm')).toBe('/assets/tex/leafy_grass/arm');
  expect(hdriStem('/assets/nalati-grasslands/hdri/kloofendal_48d_partly_cloudy_puresky')).toBe('/assets/nalati-grasslands/hdri/kloofendal_48d_partly_cloudy_puresky');
  expect(hdriStem('kloofendal_48d_partly_cloudy_puresky')).toBe('/assets/hdri/kloofendal_48d_partly_cloudy_puresky');
  const bytes = { '/assets/nalati-grasslands/tex/leafy_grass/diffuse_1k.jpg': 1 };
  expect(filePolicy('phone', 'img', { phone: {}, desktop: {} }, bytes).pbr('/assets/nalati-grasslands/tex/leafy_grass'))
    .toEqual(['/assets/nalati-grasslands/tex/leafy_grass/diffuse_1k.jpg', '/assets/nalati-grasslands/tex/leafy_grass/nor_gl.jpg', '/assets/nalati-grasslands/tex/leafy_grass/arm.jpg']);
  expect(filePolicy('desktop', 'img', { phone: {}, desktop: {} }, bytes).pbr('leafy_grass'))
    .toEqual(['/assets/tex/leafy_grass/diffuse.jpg', '/assets/tex/leafy_grass/nor_gl.jpg', '/assets/tex/leafy_grass/arm.jpg']);
  withAssetTables({ ...BAKED, bytes: { '/assets/nalati-grasslands/hdri/k_2k.sky.jpg': 1, '/assets/nalati-grasslands/hdri/k_2k.gain.png': 1 } }, () => {
    expect(bakedSkyUrls('/assets/nalati-grasslands/hdri/k')).toEqual({ color: '/assets/nalati-grasslands/hdri/k_2k.sky.jpg', gain: '/assets/nalati-grasslands/hdri/k_2k.gain.png' });
    expect(bakedSkyUrls('k')).toBeNull();
  });
});
