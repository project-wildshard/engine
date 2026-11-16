import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC15 (3), the between-worker move (Jake 11-13: "you can't leave Driftwood"). Staging's 2 workers put Nalati alone on one
// and Driftwood with the rest on the other. GC15 (3) let a walker off Driftwood's east entryway cross the road into Nalati on the other
// worker; ZONE-ENTRY (J352) retires walking into a cell: another cell is entered by its gate (ZE9, ZE16 for between workers). Since ZE6
// the walker reaches Nalati's buffer on Driftwood's road and is held at its gate, on one socket, and walks back into Driftwood.
const HOME = 'driftwood-isle', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', 'sunscar-dunes', EAST];
/** Nalati's west edge in the world's frame on staging's pitch, and its gate. */
const EAST_EDGE = 562.5 - CHUNK_HALF, EAST_GATE = EAST_EDGE + BUFFER_DEPTH;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a walker from Driftwood is held at the gate of Nalati on another worker, never handed out, and walks back, on one socket', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), east = bench.room(EAST), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || east === undefined || road === undefined || body === undefined) throw new Error('Driftwood, Nalati and Driftwood\'s road boot');
  expect(bench.road(roadName(EAST)), 'Nalati has its own road: it is on the other worker').toBeDefined();
  let closes = 0;
  a.transport.onClose(() => { closes++; });
  // On Driftwood's east entryway, 5 m inside the edge, running east (+x: the motor faces atan2(own - target), so yaw -π/2).
  body.resetPose({ x: CHUNK_HALF - 5, y: 1, z: 0 }, -Math.PI / 2);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'into Nalati\'s buffer').toBeGreaterThan(EAST_EDGE + 2); }, { timeout: 30_000, interval: 50 });
  let deepest = -Infinity;
  for (const ends = Date.now() + 3000; Date.now() < ends;) { await new Promise(resolve => { setTimeout(resolve, 50); }); deepest = Math.max(deepest, road.bodyOf('device:a')?.position.x ?? -Infinity); }
  expect(deepest, 'held at Nalati\'s gate').toBeLessThan(EAST_GATE);
  expect(road.holds('device:a'), 'still on Driftwood\'s road').toBe(true);
  expect(east.holds('device:a'), 'never handed into Nalati').toBe(false);
  // And back: west along the entryways' line into Driftwood
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 40_000, interval: 50 });
  await vi.waitFor(() => { expect(a.client.latest?.cell, 'frames from Driftwood').toBe(cellFrame(HOME)); }, { timeout: 10_000, interval: 50 });
  expect(closes, 'never redialled').toBe(0);
  expect(bench.lines.filter(line => line['at'] === 'cell.crossed' && line['to'] === EAST), 'no move into Nalati').toHaveLength(0);
});
