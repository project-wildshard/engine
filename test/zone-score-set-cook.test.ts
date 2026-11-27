// SF23: a zone's own slot set (`sets: { island: '<slug>' }`) plays outside its fence (a night or race slot), so a fence
// shard's phone whole pack carries the set's folder as it carries a bank score's (SF8n), and no other folder of the zone.
import { expect, test } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import { folderTarball } from '../src/cook/game/folderTarball';
import { openShardfile, shardHalf, type OpenShardfile } from '../src/cook/game/shardCook';

test("a fence shard's phone whole pack carries its own slot set, not another music folder", () => {
  const shard = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), { preparationOnly: true });
  const dir = `/assets/${shard.slug}/music/${shard.slug}-piano/`;
  const paths = [`${dir}music.json`, `${dir}island-calm-05125ed8.m4a`, `${dir}island-tension-7faf0468.m4a`];
  const mounts = [...paths, `/assets/${shard.slug}/music/another/calm-00000000.m4a`].map((url, index) => ({
    url, path: `mounts${url}`, bytes: 1, hash: String(index + 1).repeat(64),
  }));
  const music: NonNullable<AudioData['music']> = { id: 'score.x', base: 'pine', slots: ['pine', 'island'], bootSlots: ['pine'],
    synthLead: 'pluck', minFade: 0, source: null, sets: { pine: shard.slug, island: shard.slug }, selectMode: 'first',
    selection: [{ slots: ['island'], when: [{ field: 'scene', op: 'equals', value: 'night' }] }, { slots: ['pine'], when: [] }],
    catalogue: { mode: 'slots', extraStings: [], stingSets: {} } };
  const hash = mounts[0]?.hash ?? '';
  const fixture: OpenShardfile = { ...shard, preparationOnly: false, source: { ...shard.source, audio: { ...shard.source.audio, music } },
    cook: { version: 3, renderer: hash, inputHash: hash, packs: 'fence', fence: [hash], mounts,
      programs: { version: 2, build: 'wire-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]] } },
    read: path => path.startsWith('mounts/assets/') ? new Uint8Array(1) : shard.read(path) };
  const half = shardHalf(fixture, (_url, bytes) => bytes.length);
  const listed = (set: 'entry' | 'whole'): string[] => half.mountRows('phone', set).map(row => row.url.split('?')[0] ?? '');
  expect(listed('entry')).toEqual(paths.slice(0, 1));
  expect(listed('whole')).toEqual(paths);
  // a set named for another zone is not this zone's copy
  const other: OpenShardfile = { ...fixture, source: { ...fixture.source, audio: { ...fixture.source.audio, music: { ...music, sets: { pine: 'elsewhere' } } } } };
  expect(shardHalf(other, (_url, bytes) => bytes.length).mountRows('phone', 'whole').map(row => row.url.split('?')[0] ?? '')).toEqual(paths.slice(0, 1));
});
