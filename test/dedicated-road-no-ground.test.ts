import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC30 (Jake 11-13, "you can't leave Driftwood"): Far Reach is sky islands, with no ground at its entryways at road
// height. A seat that walked off the road into it fell out of the world, came back at Far Reach's spawn island, and every walk north
// fell off the island again: no way back to Driftwood. A cell with no ground at an entryway stays walled on the road (as a cell on
// another worker is), so a walker meets a wall on the road and can turn back; cells with ground open as before.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', CELLS = [HOME, SOUTH, 'sunscar-dunes', 'nalati-grasslands'];
/** Staging's pitch: Far Reach's north edge is this far south of Driftwood's origin. */
const FAR_EDGE = -(562.5 - CHUNK_HALF);
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a cell with no ground at its entryway is walled on the road: a walker from Driftwood stops on the road and stands', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), south = bench.room(SOUTH), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || south === undefined || road === undefined || body === undefined) throw new Error('Driftwood, Far Reach and their road boot on one worker');
  // On Driftwood's south entryway, 5 m inside the edge, running south (-z: the motor faces atan2(own - target), so yaw 0).
  body.resetPose({ x: 0, y: 1, z: -(CHUNK_HALF - 5) }, 0);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 100 });
  // The road is 62.5 m: a run crosses it in well under 15 s. It must stop at Far Reach's wall, on the road, standing.
  let nearest = 0;
  for (const ends = Date.now() + 15_000; Date.now() < ends;) {
    await new Promise(resolve => { setTimeout(resolve, 100); });
    expect(south.holds('device:a'), 'never handed into Far Reach').toBe(false);
    const at = road.bodyOf('device:a')?.position;
    if (at !== undefined) nearest = Math.min(nearest, at.z);
  }
  const at = road.bodyOf('device:a')?.position;
  expect(road.holds('device:a'), 'still on the road').toBe(true);
  expect(nearest, 'held before Far Reach\'s edge').toBeGreaterThan(FAR_EDGE);
  expect(nearest, 'and it got near it').toBeLessThan(FAR_EDGE + 10);
  expect(at?.y ?? -100, 'standing on the road, not fallen').toBeGreaterThan(-2);
  // Turning back: the run north reaches Driftwood again.
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 30_000, interval: 100 });
});
