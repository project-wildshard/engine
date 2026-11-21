// ONE-FORMAT OF30: a runtime plan whose creatures are all declared rows (Sky Reach, the Dunes) names no keeper programme.
import { expect, test } from 'vitest';
import { keeperProgram } from '../src/server/game/shardfile/bossRow';
import { keeperOwnership } from '../src/server/game/shardfile/runtimeCreatures';

test('a keeper with no programme stands an empty one and owns only its homes', () => {
  expect(keeperProgram({})).toEqual({ species: [], strikes: [] });
  const homes = [{ id: 'ray', kind: 'ray', at: [0, 0] as const, yaw: 0, respawn: 30 }];
  const owned = keeperOwnership({ homes });
  expect([...owned.actors]).toEqual(['ray']);
  expect([...owned.scripts]).toEqual([]);
});
