import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {openShardfile, shardHalf, type OpenShardfile} from '../src/cook/game/shardCook';
import {folderTarball} from '../src/cook/game/folderTarball';

// SF5d: Pine Hollow 0.0.18 declares a `fence` pack set but is unprepared, so its cook data is version 1 and records no fence
// (FP23). The phone's whole set then held none of the level's mounts, and the phone asked code-parts and the navmesh from
// the page (404, "Pine Hollow could not load"). An unprepared shard's phone whole set is its whole level.

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

it('gives an unprepared fence shard\'s phone its whole level', () => {
  const held = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), {preparationOnly: true});
  const parts = new Uint8Array([1, 2, 3, 4]), path = 'mounts/assets/z/baked/code-parts.bin', url = '/assets/z/baked/code-parts.bin';
  const mount = {url, path, hash: digest(parts), bytes: parts.length};
  const shard = (version: 1 | 3): OpenShardfile => ({
    ...held, preparationOnly: false,
    cook: version === 1 ? {version, packs: 'fence', fence: ['asset:stale'], mounts: [mount]}
      : {version, renderer: mount.hash, inputHash: mount.hash, packs: 'fence', fence: [],
        programs: {version: 2, build: 'wire-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]]}, mounts: [mount]},
    read: at => at === path ? parts : held.read(at),
  } as OpenShardfile);
  const phoneWhole = (source: OpenShardfile): readonly string[] =>
    shardHalf(source, (_url, bytes) => bytes.length).mountRows('phone', 'whole').map(row => row.url.replace(/\?v=.*$/u, ''));
  expect(phoneWhole(shard(1))).toContain(url);
  // A prepared fence shard keeps its recorded fence: a mount it never read stays out of the phone's whole set.
  expect(phoneWhole(shard(3))).not.toContain(url);
});
