import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC34 (online half; bfa15a65 is the page's): a crossing on the dedicated server hands the seat to the room it walks
// into, and that room's body started from rest (pose and health only), so a walk off the road into a cell stopped at the line while
// the page's prediction caught the server's standing body up. The arrival takes the walker's velocity, clocks and mode.
const HOME = 'driftwood-isle', CELLS = [HOME, 'far-reach', 'nalati-grasslands'], ROAD = roadName(HOME);
let bench: RoomBench | undefined;
let bot: RoomBot | undefined;
afterEach(async () => { bot?.drop(); bot = undefined; await bench?.close(); bench = undefined; });

test('a walker keeps their speed walking off the road into a cell', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = bot = new RoomBot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(ROAD), body = home?.bodyOf('device:a');
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  // Onto the road off Driftwood's south edge, then 12 m further south, on the road before the entryway at the edge's midpoint.
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(0); }, { timeout: 10_000 });
  const onRoad = road.bodyOf('device:a');
  if (onRoad === undefined) throw new Error('The road holds the seat');
  onRoad.resetPose({ x: 0, y: onRoad.position.y, z: -(CHUNK_HALF + 12) }, onRoad.yaw);
  const speeds: { where: 'road' | 'home'; speed: number }[] = [];
  const sample = setInterval(() => {
    const seat = road.bodyOf('device:a') ?? home.bodyOf('device:a');
    if (seat !== undefined) speeds.push({ where: road.holds('device:a') ? 'road' : 'home', speed: Math.hypot(seat.velocity.x, seat.velocity.z) });
  }, 1);
  // North (yaw π faces +z) into Driftwood, and on for a moment past the line.
  a.thumb = (): ReturnType<RoomBot['thumb']> => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI, pitch: 0, buttons: 0 });
  try {
    await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(cellFrame(HOME)); }, { timeout: 20_000 });
    const from = home.host.state.tick;
    await vi.waitFor(() => { expect(home.host.state.tick).toBeGreaterThanOrEqual(from + 10); }, { timeout: 10_000 });
  } finally { clearInterval(sample); }
  const first = speeds.findIndex(row => row.where === 'home');
  expect(first, 'sampled both sides of the crossing').toBeGreaterThan(0);
  const before = speeds[first - 1]?.speed ?? 0, after = speeds.slice(first).map(row => row.speed);
  expect(before, 'walking on the road').toBeGreaterThan(2);
  expect(Math.min(...after), 'still walking just past the crossing').toBeGreaterThan(before * 0.8);
  expect(bench.crashes).toEqual([]);
});
