import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC15c: the first page walk (scripts/grid-crossing-walk-proof.mjs) stopped on Driftwood's west entryway at x -249.1,
// on flat road-height ground: a native cell's baked collision kept the shard's own page walls (`nativeBake.ts` skips them only for a
// cell held near its player). The road test sets the feet past the edge; this one walks them through it by input, as a player does.
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', CELLS = [HOME, WEST, 'far-reach', 'nalati-grasslands'];
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a seat walked by input through Driftwood\'s west entryway leaves the cell for the road', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot on one worker');
  // On the entryway's deck, 10 m inside the edge, facing out (-x): the page's motor faces atan2(own - target).
  body.resetPose({ x: -(CHUNK_HALF - 10), y: 1, z: 0 }, Math.PI / 2);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: 0 });
  const xs: number[] = [];
  await vi.waitFor(() => {
    const at = home.bodyOf('device:a')?.position.x; if (at !== undefined) xs.push(at);
    expect(road.holds('device:a'), `walked to x ${String(Math.min(...xs).toFixed(2))}`).toBe(true);
  }, { timeout: 20_000, interval: 100 });
  // On along the road at a run, into Sunscar's entryway: its own page walls don't stand there either, and the seat walks on in it.
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  const west = bench.room(WEST);
  await vi.waitFor(() => { expect(west?.holds('device:a'), `on the road at x ${String(road.bodyOf('device:a')?.position.x.toFixed(2))}`).toBe(true); }, { timeout: 40_000, interval: 100 });
  const arrived = west?.bodyOf('device:a')?.position.x ?? 0;
  expect(arrived, 'in Sunscar\'s own frame, inside its east edge').toBeGreaterThan(CHUNK_HALF - 5);
  await vi.waitFor(() => { expect(arrived - (west?.bodyOf('device:a')?.position.x ?? arrived), 'it walks on into Sunscar').toBeGreaterThan(3); }, { timeout: 10_000, interval: 100 });
  expect(a.closed, 'one socket throughout').toBeNull();
});
