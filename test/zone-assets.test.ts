// SF4 (meta standalone shardfiles): a re-packed zone keeps its art under its own name, /assets/<slug>/…, and the engine's
// audio readers find a zone's music and sfx folders through the audio tables (their `$dir`), the engine-wide folder second.
// oxlint-disable-next-line import/no-nodejs-modules -- A fixture public/ tree for the build's audio table.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ZONE_DIR, audioDirOf, audioManifestRow, isAudioUrl, zoneAssetUrl } from '../src/shared/engine/boot/zoneAssets';
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
