import {expect, test} from 'vitest';
import type {AudioData} from '@wildshard/format/audio';
import {decodeStyle} from '../src/client/engine/audio/Stems';
import {styleFiles} from '../src/shared/engine/audio/bootAudio';
import {installAssetTables} from '../src/shared/engine/boot/tables';
import {folderTarball} from '../src/cook/game/folderTarball';
import {openShardfile, shardHalf, type OpenShardfile} from '../src/cook/game/shardCook';

test('a zone bank keeps island timing and piano stings while moving the stems', async () => {
  const piano = '/assets/music/piano/', dir = '/assets/driftwood-isle/music/driftwood-isle/';
  const island = {calm: 'calm.m4a', tension: 'tension.m4a', bpm: 76.781, beatsPerBar: 4,
    loopStart: 14.3035, loopEnd: 54.9384, duration: 58.0693};
  const engine = {slots: {island, title: {...island, calm: 'title.m4a', tension: undefined}},
    stings: {chunk: 'chunk.m4a', death: 'death.m4a', pickup: 'pickup.m4a'}};
  const music = {piano: engine, 'driftwood-isle': {slots: {island}, stings: {chunk: 'unused.m4a'}}};
  const expected = [`${piano}title.m4a`, `${dir}calm.m4a`, `${dir}tension.m4a`, `${piano}pickup.m4a`, `${piano}death.m4a`, `${piano}chunk.m4a`];
  const bytes = Object.fromEntries([...expected, `${piano}calm.m4a`, `${piano}tension.m4a`, `${dir}unused.m4a`].map(url => [url, 4]));
  installAssetTables({music, bytes, versions: {}, sfx: {}, packs: {}});
  const source = {dir, manifestKey: 'driftwood-isle'}, slots = ['title', 'island'];
  expect(styleFiles('piano', slots, true, true, source)).toEqual(expected);
  expect(styleFiles('piano', slots, false, false, source)).toEqual([`${piano}title.m4a`, `${dir}calm.m4a`]);
  const reads: string[] = [];
  const bank = await decodeStyle('piano', slots, url => {
    reads.push(url);
    return Promise.resolve(new ArrayBuffer(4));
  }, () => Promise.resolve({duration: island.duration} as AudioBuffer), undefined, 'base', undefined, true, source);
  expect(reads).toEqual(expected);
  expect(bank.slots.get('island')?.spec).toMatchObject(island);
  expect(bank.slots.get('island')?.tension).toBeDefined();
  expect([...bank.stings.keys()].sort()).toEqual(['chunk', 'death', 'pickup']);
});

test('a muted author fence still carries the scoped recordings in the phone whole pack', () => {
  const shard = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), {preparationOnly: true});
  const dir = `/assets/${shard.slug}/music/island/`;
  const paths = [`${dir}music.json`, `${dir}calm-00000000.m4a`, `${dir}tension-00000000.m4a`];
  const mounts = [...paths, `/assets/${shard.slug}/music/another/calm-00000000.m4a`].map((url, index) => ({
    url, path: `mounts${url}`, bytes: 1, hash: String(index + 1).repeat(64),
  }));
  const music: NonNullable<AudioData['music']> = {id: 'island', base: 'island', slots: ['island'], bootSlots: ['island'], synthLead: 'marimba', minFade: 0,
    source: {dir, manifestKey: 'island'}, sets: {}, selection: [{slots: ['island'], when: []}], selectMode: 'first',
    catalogue: {mode: 'bank', extraStings: [], stingSets: {}}};
  const hash = mounts[0]?.hash ?? '';
  const fixture: OpenShardfile = {...shard, preparationOnly: false, source: {...shard.source, audio: {...shard.source.audio, music}},
    cook: {version: 3, renderer: hash, inputHash: hash, packs: 'fence', fence: [hash], mounts,
      programs: {version: 2, build: 'wire-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]]}},
    read: path => path.startsWith('mounts/assets/') ? new Uint8Array(1) : shard.read(path)};
  const half = shardHalf(fixture, (_url, bytes) => bytes.length);
  const listed = (set: 'entry' | 'whole'): string[] => half.mountRows('phone', set).map(row => row.url.split('?')[0] ?? '');
  expect(listed('entry')).toEqual(paths.slice(0, 1));
  expect(listed('whole')).toEqual(paths);
});
