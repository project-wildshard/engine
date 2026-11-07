import { expect, test } from 'vitest';
import { chapterObservationReader, type ChapterDirectorRows } from '@wildshard/format/chapterDirector';
import { Flags } from '@wildshard/engine/world/interact/flags';

test('compiled chapter observations read live flags and poses, including silent restore', () => {
  const rows: ChapterDirectorRows['observations'] = {
    altar: { flag: 'used:altar' }, dead: { flag: 'dead:captain' }, seen: { flag: 'seen:dawn' },
    x: { read: 'player-x' }, reward: { read: 'reward-z' }, night: { read: 'night' }, clock: { read: 'day-present' }, literal: 17,
  };
  const flags = new Flags('observation-reader', false), frame = {
    flags, day: { night: 0.4 }, player: { x: 1, z: 2 }, reward: { x: 3, z: 4 },
  };
  const read = chapterObservationReader(rows, frame);
  expect(read()).toMatchObject({ altar: 0, dead: 0, seen: 0, x: 1, reward: 4, night: 0.4, clock: 1, literal: 17 });
  flags.set('used:altar'); frame.player.x = 7; frame.reward.z = 9; frame.day.night = 0.8;
  expect(read()).toMatchObject({ altar: 1, x: 7, reward: 9, night: 0.8 });
  flags.restore(['seen:dawn', 'dead:captain']);
  expect(read()).toMatchObject({ altar: 0, dead: 1, seen: 1 });
  expect(chapterObservationReader(rows, { ...frame, day: null })()).toMatchObject({ night: 0, clock: 0 });
  expect(() => chapterObservationReader(rows, { ...frame, reward: null })()).toThrow('pose');
});
