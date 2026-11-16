import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC30 (Jake 11-13, "you can't leave Driftwood"): Far Reach is sky islands. A seat that walked off the road into it
// fell out of the world, so a cell with no ground at an entryway stayed walled on the road. GC30b (J322, "no walls"): Sky Reach rev 3
// (cdbb400c) builds a dock at each of Far Reach's four entryways, and its probe finds ground there. Since ZONE-ENTRY ZE6 (J352) the road
// walls every cell but a seat's home and floors each buffer: a walker from Driftwood runs into Far Reach's north buffer, stands on its
// floor at the gate (never handed in, never fallen) and turns back into Driftwood.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', CELLS = [HOME, SOUTH, 'sunscar-dunes', 'nalati-grasslands'];
/** Far Reach's north edge in the world's frame on staging's pitch, and its gate. */
const SOUTH_EDGE = -(562.5 - CHUNK_HALF), SOUTH_GATE = SOUTH_EDGE - BUFFER_DEPTH;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('Far Reach\'s north buffer is floored on the road: a walker from Driftwood stands at its gate, never handed in, and turns back', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), south = bench.room(SOUTH), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || south === undefined || road === undefined || body === undefined) throw new Error('Driftwood, Far Reach and their road boot on one worker');
  expect(south.entrywaysStand(), 'Far Reach stands at its entryways').toBe(true);
  // On Driftwood's south entryway, 5 m inside the edge, running south (-z: the motor faces atan2(own - target), so yaw 0).
  body.resetPose({ x: 0, y: 1, z: -(CHUNK_HALF - 5) }, 0);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 100 });
  // The road is 62.5 m: a run crosses it in well under 15 s, into the buffer, to the gate.
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.z ?? 0, 'into Far Reach\'s buffer').toBeLessThan(SOUTH_EDGE - 2); }, { timeout: 20_000, interval: 100 });
  let lowest = Number.POSITIVE_INFINITY, deepest = Number.POSITIVE_INFINITY;
  for (const ends = Date.now() + 2_000; Date.now() < ends;) {
    await new Promise(resolve => { setTimeout(resolve, 100); });
    const at = road.bodyOf('device:a')?.position;
    lowest = Math.min(lowest, at?.y ?? -100); deepest = Math.min(deepest, at?.z ?? -1000);
  }
  expect(lowest, 'standing on the buffer\'s floor, not fallen').toBeGreaterThan(-2);
  expect(deepest, 'held at the gate').toBeGreaterThan(SOUTH_GATE);
  expect(south.holds('device:a'), 'never handed into Far Reach').toBe(false);
  // Turning back: the run north reaches Driftwood again.
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 30_000, interval: 100 });
});
