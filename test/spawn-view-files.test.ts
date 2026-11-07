import { expect, test } from 'vitest';
import { SPAWN_VIEW_REACH_M, spawnViewSceneFiles } from '@wildshard/format/spawnView';
import { SPAWN_VIEW_M } from '../src/client/game/shardfile/controlRefinement';

// DL21: a cold Nine visit fetched its late native-slabs scene tiles one by one inside the spawn-view fence (45 s in the
// Simulator) because the default spawn set left them out. The build now carries every tiled scene file in the fence's reach.
const sections = (chunks: number[][][]): Map<string, unknown> => new Map<string, unknown>([
  ['world/spawn', { spawn: { x: 0, y: 100, z: 0, yaw: 0 } }],
  ['world/scenes', { libraries: [{ id: 'slabs', tiles: [{ tile: 3, files: chunks.map((spheres, at) => ({ file: `f${at}`, chunks: spheres.map(sphere => ({ sphere })) })) }] }] }],
]);

test('the build\'s reach is the runtime fence\'s', () => { expect(SPAWN_VIEW_REACH_M).toBe(SPAWN_VIEW_M); });

test('a scene tile file is in reach when any chunk sphere\'s surface is within the fence radius of the spawn', () => {
  const files = spawnViewSceneFiles(sections([
    [[10, 100, 10, 5]], // beside the spawn
    [[400, 100, 0, 5], [0, 100, 300, 90]], // the second chunk's surface is 210 m away
    [[0, 100, 600, 50]], // 550 m: out of reach
    [[0, 350, 0, 20]], // 250 m straight up: out of reach (3-D)
  ]));
  expect([...files].sort()).toEqual(['f0', 'f1']);
});

test('no spawn or no tiled scene library means no extra files', () => {
  expect(spawnViewSceneFiles(new Map([['world/scenes', { libraries: [] }]])).size).toBe(0);
  expect(spawnViewSceneFiles(new Map([['world/spawn', { spawn: { x: 0, z: 0 } }]])).size).toBe(0);
});
