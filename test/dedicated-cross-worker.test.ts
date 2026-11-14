import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC15 (3), the between-worker move (Jake 11-13: "you can't leave Driftwood"). Staging's 2 workers put Nalati alone on one
// and Driftwood with the rest on the other, so each road walled Nalati off (GC31's stopgap was one worker). Now a walker off Driftwood's
// east entryway crosses the road into Nalati on the other worker on the same socket: the client hears `travel`, then Nalati's welcome
// and frames, with no redial; and walks back the same way into Driftwood.
const HOME = 'driftwood-isle', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', 'sunscar-dunes', EAST];
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a walker crosses from Driftwood into Nalati on another worker and back, on one socket', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), east = bench.room(EAST), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || east === undefined || road === undefined || body === undefined) throw new Error('Driftwood, Nalati and Driftwood\'s road boot');
  expect(bench.road(roadName(EAST)), 'Nalati has its own road: it is on the other worker').toBeDefined();
  let closes = 0, travels = 0;
  a.transport.onClose(() => { closes++; });
  a.client.onTravel(() => { travels++; });
  // On Driftwood's east entryway, 5 m inside the edge, running east (+x: the motor faces atan2(own - target), so yaw -π/2).
  body.resetPose({ x: CHUNK_HALF - 5, y: 1, z: 0 }, -Math.PI / 2);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  await vi.waitFor(() => { expect(east.holds('device:a'), 'into Nalati, on the other worker').toBe(true); }, { timeout: 30_000, interval: 50 });
  expect(road.holds('device:a'), 'the road let the seat go').toBe(false);
  // Frames from Nalati reach the same socket: the client's cell is Nalati's, and the walker keeps moving east in its frame
  await vi.waitFor(() => { expect(a.client.latest?.cell, 'frames from Nalati').toBe(cellFrame(EAST)); }, { timeout: 10_000, interval: 50 });
  const inside = east.bodyOf('device:a')?.position.x ?? 0;
  await vi.waitFor(() => { expect(east.bodyOf('device:a')?.position.x ?? 0, 'moving under input in Nalati').toBeGreaterThan(inside + 3); }, { timeout: 10_000, interval: 50 });
  expect(closes, 'never redialled').toBe(0);
  expect(bench.lines.filter(line => line['at'] === 'cell.crossed' && line['to'] === EAST && line['moved'] === true), 'the door counts the move').toHaveLength(1);
  // And back: west out of Nalati onto its road, then into Driftwood on the first worker
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 40_000, interval: 50 });
  await vi.waitFor(() => { expect(a.client.latest?.cell, 'frames from Driftwood').toBe(cellFrame(HOME)); }, { timeout: 10_000, interval: 50 });
  expect(east.holds('device:a')).toBe(false);
  expect(closes, 'never redialled').toBe(0);
  expect(travels, 'a travel at each move: Driftwood, road, Nalati, road, Driftwood').toBeGreaterThanOrEqual(4);
});
