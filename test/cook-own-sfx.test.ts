// SF11: no pin copies a zone's mounts under public/, so the boot reads a zone's own sound-effect set (its `sfx.json` and
// variants) from the zone's own mounts only. A fence shard's phone whole set carries each own sfx folder, as it carries
// an own score (SF23): without it Driftwood's boot drew 75 recordings, none of its 16 own sfx variants.
import { expect, test } from 'vitest';
import { folderTarball } from '../src/cook/game/folderTarball';
import { openShardfile, ownSfxDirs, shardHalf, type OpenShardfile } from '../src/cook/game/shardCook';
import { GOLDEN_FIXTURES } from '../src/scripts/cookVersion';
import { ownMountRows } from '../src/cook/game/entryTotals';

test("a zone's own sfx set folders, and nothing else, are its own", () => {
  const urls = ['/assets/isle/sfx/isle/sfx.json', '/assets/isle/sfx/isle/gull-1-00000000.m4a', '/assets/isle/sfx/night/sfx.json',
    '/assets/other/sfx/other/sfx.json', '/assets/sfx/best/sfx.json', '/assets/isle/music/isle-piano/music.json', '/assets/isle/sfx/isle/notes.json'];
  expect(ownSfxDirs(urls, 'isle')).toEqual(['/assets/isle/sfx/isle/', '/assets/isle/sfx/night/']);
  expect(ownSfxDirs(urls, '_isle')).toEqual(['/assets/isle/sfx/isle/', '/assets/isle/sfx/night/']);
  expect(ownSfxDirs(urls, 'other')).toEqual(['/assets/other/sfx/other/']);
});

test("a fence shard's phone whole set carries its own sfx folder, not another zone's or the engine's", () => {
  const shard = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), { preparationOnly: true });
  const fenced = `/assets/${shard.slug}/props/crate.glb`, dir = `/assets/${shard.slug}/sfx/${shard.slug}/`;
  const own = [`${dir}sfx.json`, `${dir}gull-1-1a358b4e.m4a`, `${dir}gull-2-42389b0a.m4a`];
  const elsewhere = ['/assets/other-zone/sfx/other-zone/sfx.json', '/assets/other-zone/sfx/other-zone/gull-1-83ed831d.m4a',
    `/assets/${shard.slug}/sfx-notes/sfx.json`, '/assets/sfx/best/hit-1-aefbc41d.m4a'];
  const mounts = [fenced, ...own, ...elsewhere].map((url, index) => ({ url, path: `mounts${url}`, bytes: 1, hash: String(index + 1).repeat(64) }));
  const hash = mounts[0]?.hash ?? '';
  const fixture: OpenShardfile = { ...shard, preparationOnly: false, source: { ...shard.source, audio: { ...shard.source.audio, music: undefined } },
    cook: { version: 3, renderer: hash, inputHash: hash, packs: 'fence', fence: [hash], mounts,
      programs: { version: 2, build: 'wire-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]] } },
    read: path => path.startsWith('mounts/assets/') ? new Uint8Array(1) : shard.read(path) };
  const half = shardHalf(fixture, (_url, bytes) => bytes.length);
  const listed = (tier: 'phone' | 'desktop', set: 'entry' | 'whole'): string[] => half.mountRows(tier, set).map(row => row.url.split('?')[0] ?? '');
  expect(listed('phone', 'entry')).toEqual([fenced]);
  expect(listed('phone', 'whole')).toEqual([fenced, ...own]);
  // a desktop's whole set already lists the whole level
  expect(listed('desktop', 'whole')).toEqual(mounts.map(row => row.url));
});

// The guard behind the cook version: the golden cook takes a prepared fence shard with its own sfx set (made-up-fence), so
// a change to what a fence shard's phone whole set carries moves the golden digest (44ab5ec53 left made-up-old's unmoved).
test('the golden cook takes a fence shard whose phone whole set carries its own sfx', () => {
  expect(GOLDEN_FIXTURES).toContain('made-up-fence');
  const half = shardHalf(openShardfile(folderTarball('test/fixtures/made-up-fence')), (_url, bytes) => bytes.length);
  const listed = (set: 'entry' | 'whole'): string[] => half.mountRows('phone', set).map(row => row.url.split('?')[0] ?? '');
  expect(listed('entry')).toEqual(['/assets/cli-fixture/props/fenced.bin']);
  expect(listed('whole')).toEqual(['/assets/cli-fixture/props/fenced.bin', '/assets/cli-fixture/sfx/cli-fixture/sfx.json',
    '/assets/cli-fixture/sfx/cli-fixture/gull-1-1a358b4e.m4a']);
});

// SF11: the app build lists a zone's own boot recordings and inventory rows from its shardfile, not from public/.
test("the build finds a zone's own mount by its page URL, and no engine file", () => {
  const half = shardHalf(openShardfile(folderTarball('test/fixtures/made-up-fence')), (_url, bytes) => bytes.length);
  const own = ownMountRows(half);
  const gull = own('/assets/cli-fixture/sfx/cli-fixture/gull-1-1a358b4e.m4a');
  expect(gull?.url.split('?')[0]).toBe('/assets/cli-fixture/sfx/cli-fixture/gull-1-1a358b4e.m4a');
  expect(gull === undefined ? undefined : new TextDecoder().decode(half.read(gull.url))).toBe('a made-up own sfx variant');
  expect(own('/assets/cli-fixture/sfx/cli-fixture/sfx.json?v=00000000')?.url.split('?')[0]).toBe('/assets/cli-fixture/sfx/cli-fixture/sfx.json');
  expect(own('/assets/sfx/best/hit-1-aefbc41d.m4a')).toBeUndefined();
});
