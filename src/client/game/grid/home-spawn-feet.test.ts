import { expect, test } from 'vitest';
import { homeSpawnFeet } from './liveSession';

// SF22: images-only Dunes declares the format's default `world/spawn` (0, 2, 0) on dunes 18 m high. `wildshard dev` stood
// its player there, under the sand: from below, the near tiles' faces are culled and the hero drew an orange glow.
test('a home spawn with a height stands at least on its terrain, as its server stands it', () => {
  expect(homeSpawnFeet(2, () => 18.05, () => 18.05)).toBeCloseTo(18.15, 5);
  // a height over the terrain (a deck, a built floor) is kept as authored
  expect(homeSpawnFeet(30, () => 4, () => 31)).toBe(30);
});

test('a home spawn with no height stands on the highest surface there, a deck included (E463)', () => {
  expect(homeSpawnFeet(undefined, () => 0, () => 3.2)).toBeCloseTo(3.7, 5);
});
