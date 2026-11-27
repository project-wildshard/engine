// oxlint-disable-next-line import/no-nodejs-modules -- the mounts carry their hashes.
import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {openShardfile, shardHalf, type OpenShardfile} from '../src/cook/game/shardCook';
import {folderTarball} from '../src/cook/game/folderTarball';

// SF7j (J525): Nine's phone set carried its hand-made `scroll.phone.png` in place of `scroll.png`, but the page never names a
// shard's phone copy, so the phone asked `scroll.png` and got two 404s and an abort; Pine's phone 404ed the same way on
// `rock_moss_set_01_lod.glb` beside its `.phone.glb`. A phone keeps every shard original, model or image.
it('a phone set keeps a shard original beside its hand-made phone copy, of any format, models too', () => {
  const shard = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), {preparationOnly: true});
  const A = `/assets/${shard.slug}/`;
  const urls = [`${A}scroll.png`, `${A}scroll.phone.png`, `${A}leaf.webp`, `${A}leaf.phone.webp`, `${A}rock.jpg`, `${A}rock.phone.webp`, `${A}far.glb`, `${A}far.phone.glb`,
    `${A}rock_moss_set_01_lod.glb`, `${A}rock_moss_set_01_lod.phone.glb`, `${A}sky.desktop.jpg`];
  const bytes = new Map(urls.map(url => [url, new TextEncoder().encode(url)]));
  const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
  const fixture: OpenShardfile = {...shard, preparationOnly: false,
    cook: {version: 1, mounts: urls.map(url => ({url, path: url, bytes: bytes.get(url)?.length ?? 0, hash: hash(bytes.get(url) ?? new Uint8Array())}))},
    read: path => bytes.get(path) ?? shard.read(path)};
  const half = shardHalf(fixture, (_url, data) => data.length, undefined);
  const on = (tier: 'phone' | 'desktop'): readonly string[] => half.mountRows(tier, 'whole').map(row => row.url.replace(/\?.*$/u, '')).filter(url => url.startsWith(A)).sort();
  expect(on('phone')).toEqual([`${A}far.glb`, `${A}far.phone.glb`, `${A}leaf.phone.webp`, `${A}leaf.webp`, `${A}rock.jpg`, `${A}rock.phone.webp`,
    `${A}rock_moss_set_01_lod.glb`, `${A}rock_moss_set_01_lod.phone.glb`, `${A}scroll.phone.png`, `${A}scroll.png`]);
  expect(on('desktop')).toEqual([`${A}far.glb`, `${A}leaf.webp`, `${A}rock.jpg`, `${A}rock_moss_set_01_lod.glb`, `${A}scroll.png`,
    `${A}sky.desktop.jpg`]);
});
