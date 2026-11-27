// SF23: the engine's piano style keeps only its title. Every other slot a zone plays is its own set (`sets.<slot>` is
// the zone's slug, its files under `/assets/<slug>/music/<slug>-piano/`), so no pinned product may name an engine slot
// beside the title: the cook would derive a file the engine no longer ships.
// oxlint-disable-next-line import/no-nodejs-modules -- The proof reads each pinned product's audio section.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { engineMusicSlots, type EngineMusicRows } from '@wildshard/format/engineMusic';

interface PinRow { readonly slug: string; readonly uploadNumber: number }
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

// Each installed copy of a pin: the whole product (`pins.ts install`) or its Ring 1 server slice (`pins.ts slice`).
const pins = (read('test/pins/shardfiles.json') as { shards: readonly PinRow[] }).shards;
const audio = pins.flatMap(pin => ['out', 'out/.slices']
  .map(root => `${root}/${pin.slug}/sections/audio/audio.json`).filter(path => existsSync(path)).slice(0, 1)
  .map(path => ({ pin, path })));

test.skipIf(audio.length === 0)('no pinned product plays an engine music slot but the title (SF23)', () => {
  const named = audio.flatMap(({ pin, path }) => {
    const music = (read(path) as { audio: { music?: EngineMusicRows } }).audio.music;
    const engine = music === undefined ? [] : engineMusicSlots(music).filter(slot => slot !== 'title');
    return engine.length === 0 ? [] : [`${pin.slug} r${pin.uploadNumber}: ${engine.join(', ')}`];
  });
  expect(named, 'carry these slots as the zone\'s own set; the engine ships only its title').toEqual([]);
});
