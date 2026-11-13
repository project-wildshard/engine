import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC28 (GC15c item 3, Jake 11-13 "you can't leave Driftwood"): a crossing worker whose server book has no grid pack reads
// no road strips. It used to open its cells onto a road with no ground, wall-less, so a player walking out fell through the world.
// With no strips there is no road: the cells open lone, as with the setting off. GC36 (J322): a lone cell has no edge walls either,
// so a walker who leaves it falls and the fall floor puts them back on the ground they last stood on.
const HOME = 'driftwood-isle', CELLS = [HOME, 'sunscar-dunes', 'far-reach', 'nalati-grasslands'];
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a crossing worker with no grid strips opens no road and keeps its cells lone', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, strips: async () => [] });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), body = home?.bodyOf('device:a');
  if (home === undefined || body === undefined) throw new Error('Driftwood boots');
  expect(bench.road(roadName(HOME)), 'no road on a worker with no strips').toBeUndefined();
  // On the west entryway's deck, 10 m inside the edge, walking out (-x): no wall holds the body; it leaves the cell and falls.
  body.resetPose({ x: -(CHUNK_HALF - 10), y: 1, z: 0 }, Math.PI / 2);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: 0 });
  let past = Infinity;
  await vi.waitFor(() => { past = Math.min(past, home.bodyOf('device:a')?.position.x ?? 0); expect(past, 'walked past Driftwood\'s west edge').toBeLessThan(-CHUNK_HALF - 2); }, { timeout: 8000, interval: 10 });
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: 0 });
  // The lone cell's fall floor is soft: back on the ground they last stood on (the edge's lip at most), still seated in Driftwood.
  await vi.waitFor(() => {
    expect(home.holds('device:a'), 'still seated in Driftwood').toBe(true);
    expect(home.bodyOf('device:a')?.position.x ?? -1000, 'back at the edge').toBeGreaterThan(-CHUNK_HALF - 1);
    expect(home.bodyOf('device:a')?.position.y ?? -100, 'standing, not fallen through').toBeGreaterThan(-5);
  }, { timeout: 15_000 });
});
