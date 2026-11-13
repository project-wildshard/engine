// @vitest-environment happy-dom
// AUDIO AU16 (J304): the engine plays one music style, piano. There is no Settings choice, an old save that picked folk or
// orchestral plays piano, and the build ships no folk or orchestral music.
// oxlint-disable-next-line import/no-nodejs-modules -- List the tracked music files.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import { saveStorage } from '../src/client/engine/saves/slots';
import { installAssetTables, type AssetTables } from '../src/shared/engine/boot/tables';
import { PUBLIC_BYTES } from '../src/client/game/boot/bytes.generated';
import { ASSET_VERSIONS } from '../src/client/game/boot/versions.generated';
import { MUSIC_MANIFESTS, SFX_MANIFESTS } from '../src/client/game/boot/audio.generated';

// A player's save from before AU16, read when Settings loads.
saveStorage('global').setItem('settings', JSON.stringify({ musicStyle: 'folk', volume: 0.5 }));
const settings = await import('../src/client/engine/ui/Settings');
const { bootFiles } = await import('../src/client/engine/boot/extras');
const { createCatalogueAudio } = await import('../src/client/engine/audio/levelAudio');
const { Music } = await import('../src/client/engine/audio/Music');
const { defaultBootAudio } = await import('../src/shared/engine/audio/bootAudio');

const tables: AssetTables = { bytes: PUBLIC_BYTES, versions: ASSET_VERSIONS, music: MUSIC_MANIFESTS, sfx: SFX_MANIFESTS, packs: {} };
installAssetTables(tables);
const blank = { sky: [], baked: [], terrain: [], trees: [], cabins: [], props: [], physics: [], art: [], music: [], sfx: [] };
const level = { slug: 'fixture', card: { thumb: 'data:,', portrait: 'data:,', landscape: 'data:,' }, boot: { files: [], sources: () => blank } } as never;
// A Driftwood-shaped catalogue: the title and one theme slot, an island bed, sample overlay.
const catalogue = { music: { bootSlots: ['title', 'island'], controlTension: 'late' },
  samples: { bed: 'island', set: 'fixture-isle', loopGains: { island: 0.5 },
    catalogue: { inventoryOmitSlots: [], loopOrder: [], overlaySamples: true, ownMusic: false, priorityOwn: false } } } as unknown as AudioData;
const otherStyle = /\/assets\/music\/(?:[a-z0-9-]+-)?(?:folk|orchestral)\//u;

test('a save holding musicStyle folk boots and plays piano only', async () => {
  expect(settings.getNumber('volume')).toBe(0.5); // the rest of the save still loads
  const profile = await createCatalogueAudio(catalogue), files = bootFiles(level, 'img', profile, false);
  expect(files.music.length).toBeGreaterThan(0);
  expect(files.music.every(url => url.startsWith('/assets/music/piano/'))).toBe(true);
  expect(profile.files().music.filter(url => otherStyle.test(url))).toEqual([]);
  const music = new Music({} as never);
  expect(music.genre).toBe('piano');
  expect(Object.keys(settings)).not.toContain('getMusicStyle');
  // The next save drops the retired pick.
  settings.setNumber('volume', 0.6);
  expect(JSON.parse(saveStorage('global').getItem('settings') ?? '{}')).not.toHaveProperty('musicStyle');
});

test('no music manifest or download names a folk or orchestral file', () => {
  expect(Object.keys(MUSIC_MANIFESTS)).not.toContain('folk');
  expect(Object.keys(MUSIC_MANIFESTS)).not.toContain('orchestral');
  expect(Object.keys(MUSIC_MANIFESTS)).toContain('piano');
  const tracked = execFileSync('git', ['ls-files', 'public/assets/music'], { encoding: 'utf8' }).split('\n');
  expect(tracked.filter(path => /\/(?:folk|orchestral)\//u.test(path))).toEqual([]);
  expect(defaultBootAudio(catalogue).filter(url => otherStyle.test(url))).toEqual([]);
});
