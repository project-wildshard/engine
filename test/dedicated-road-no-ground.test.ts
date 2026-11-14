import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC30 (Jake 11-13, "you can't leave Driftwood"): Far Reach is sky islands. A seat that walked off the road into it
// fell out of the world, so a cell with no ground at an entryway stays walled on the road (as a cell on another worker is). GC30b
// (J322, "no walls"): Sky Reach rev 3 (cdbb400c) builds a dock at each of Far Reach's four entryways, so the probe finds ground there
// and the wall is gone: a walker from Driftwood is handed into Far Reach, stands at its north entryway and can turn back. A bare
// cell is still walled (the probe's own cases: entryway-stands tests).
const HOME = 'driftwood-isle', SOUTH = 'far-reach', CELLS = [HOME, SOUTH, 'sunscar-dunes', 'nalati-grasslands'];
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('Far Reach\'s docks are entryway ground: no road wall, a walker from Driftwood is handed in, stands, and turns back', { timeout: 120_000 }, async () => {
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
  // The road is 62.5 m: a run crosses it in well under 15 s, past where GC30's wall stood, into Far Reach.
  await vi.waitFor(() => { expect(south.holds('device:a'), 'handed into Far Reach').toBe(true); }, { timeout: 20_000, interval: 100 });
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  let lowest = Number.POSITIVE_INFINITY;
  for (const ends = Date.now() + 2_000; Date.now() < ends;) {
    await new Promise(resolve => { setTimeout(resolve, 100); });
    lowest = Math.min(lowest, south.bodyOf('device:a')?.position.y ?? -100);
  }
  expect(lowest, 'standing on Far Reach\'s north dock, not fallen').toBeGreaterThan(-2);
  expect(south.bodyOf('device:a')?.position.z ?? 0, 'at the entryway, not moved to the spawn').toBeGreaterThan(CHUNK_HALF - 20);
  // Turning back: the run north reaches Driftwood again.
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 30_000, interval: 100 });
});
