import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC15c: the first page walk (src/scripts/grid-crossing-walk-proof.mjs) stopped on Driftwood's west entryway at x -249.1,
// on flat road-height ground: a native cell's baked collision kept the shard's own page walls (`nativeBake.ts` skips them only for a
// cell held near its player). The road test sets the feet past the edge; this one walks them through it by input, as a player does.
// ZONE-ENTRY ZE6 (J352): the worker's road is walled as the page is. One road world holds every seat, and seats have different
// homes, so each seat's motor passes its own home's walls and meets every other cell's: A (home Driftwood) walks out and back in by
// input, stops at Sunscar's wall off its entryway and at its gate through it, never handed in; B (home Sunscar) on the same road
// walks out of Sunscar and back in. Without the per-seat pass (`openHomeFor`) neither walks back into its home.
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', CELLS = [HOME, WEST, 'far-reach', 'nalati-grasslands'];
/** Sunscar's east edge in the world's (and the road's) frame on staging's pitch, and its gate, the buffer's depth further in. */
const WEST_EDGE = -(562.5 - CHUNK_HALF), WEST_GATE = WEST_EDGE - BUFFER_DEPTH;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });
/** Hold `yaw` with the key down (the page's motor faces atan2(own - target): +x is -π/2, -x is π/2). */
const heading = (yaw: number, buttons = 0) => () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons });
const still = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });

test('a seat walks by input out of its home and back in; another cell\'s wall and gate hold it on the road; a seat from that cell walks into it', { timeout: 180_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: 'device:b', name: 'B', shard: WEST, cell: WEST, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, saves });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'), b = new RoomBot(bench.url, 'bench', 'device:b', 'B'); bots.push(a, b);
  expect(await a.arrived()).toBe(true);
  expect(await b.arrived()).toBe(true);
  const home = bench.room(HOME), west = bench.room(WEST), road = bench.road(roadName(HOME));
  if (home === undefined || west === undefined || road === undefined) throw new Error('Driftwood, Sunscar and their road boot on one worker');
  expect(west.holds('device:b'), 'B is seated in Sunscar').toBe(true);

  // B, home Sunscar: out of its east entryway onto the road by input, then back west into Sunscar through its buffer and gate line
  west.bodyOf('device:b')?.resetPose({ x: CHUNK_HALF - 10, y: 1, z: 0 }, -Math.PI / 2);
  b.thumb = heading(-Math.PI / 2);
  await vi.waitFor(() => { expect(road.holds('device:b'), 'B onto the road').toBe(true); }, { timeout: 20_000, interval: 100 });
  b.thumb = heading(Math.PI / 2);
  await vi.waitFor(() => { expect(west.holds('device:b'), `B back into Sunscar from x ${String(road.bodyOf('device:b')?.position.x.toFixed(2))}`).toBe(true); }, { timeout: 30_000, interval: 100 });
  b.thumb = still;

  // A, home Driftwood: on the entryway's deck, 10 m inside the edge, facing out (-x), walked onto the road by input
  home.bodyOf('device:a')?.resetPose({ x: -(CHUNK_HALF - 10), y: 1, z: 0 }, Math.PI / 2);
  a.thumb = heading(Math.PI / 2);
  const xs: number[] = [];
  await vi.waitFor(() => {
    const at = home.bodyOf('device:a')?.position.x; if (at !== undefined) xs.push(at);
    expect(road.holds('device:a'), `walked to x ${String(Math.min(...xs).toFixed(2))}`).toBe(true);
  }, { timeout: 20_000, interval: 100 });
  // On along the road at a run, through Sunscar's east entryway: into its buffer, held at its gate, never handed in
  a.thumb = heading(Math.PI / 2, NET_BUTTONS.sprint);
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'A into Sunscar\'s buffer').toBeLessThan(WEST_EDGE - 2); }, { timeout: 30_000, interval: 100 });
  let deepest = Infinity;
  for (const ends = Date.now() + 1000; Date.now() < ends;) {
    await sleep(50);
    expect(west.holds('device:a'), 'A is never handed into Sunscar').toBe(false);
    deepest = Math.min(deepest, road.bodyOf('device:a')?.position.x ?? Infinity);
  }
  expect(road.holds('device:a'), 'A stays on the road').toBe(true);
  expect(deepest, 'held at Sunscar\'s gate').toBeGreaterThan(WEST_GATE);
  // Off the entryway (ENTRY_WIDTH 8 m), 15 m north along Sunscar's edge, walked there by input (a pose set under a running bot is undone by its
  // next move): its wall stands on the edge line. Every leg from here runs (ZE6's main-watch: walked, the file took 73 s on CI
  // against its 60 s budget; the legs are 40 to 60 m of road)
  const at = (): { x: number; z: number } => road.bodyOf('device:a')?.position ?? { x: NaN, z: NaN };
  const run = (yaw: number) => heading(yaw, NET_BUTTONS.sprint);
  a.thumb = run(-Math.PI / 2);
  await vi.waitFor(() => { expect(at().x, 'back out of the buffer').toBeGreaterThan(WEST_EDGE + 6); }, { timeout: 20_000, interval: 50 });
  a.thumb = run(Math.PI);
  await vi.waitFor(() => { expect(at().z, 'north along the road').toBeGreaterThan(15); }, { timeout: 30_000, interval: 50 });
  a.thumb = run(Math.PI / 2);
  deepest = Infinity;
  for (const ends = Date.now() + 1000; Date.now() < ends;) { await sleep(50); deepest = Math.min(deepest, at().x); }
  expect(deepest, 'held at Sunscar\'s wall off the entryway').toBeGreaterThan(WEST_EDGE);
  expect(deepest, 'it walked up to the wall').toBeLessThan(WEST_EDGE + 2);
  expect(west.holds('device:a'), 'A is never handed into Sunscar').toBe(false);
  // Back into Driftwood's west entryway by input: its walls stand open for A, and the road hands A back in. The ~70 m of plain road
  // back was walked out already: A stands still, is placed 6 m off Driftwood's edge on the entryways' line, and runs in (main-watch
  // 2026-11-16: the return legs were 12 s of the file's 41 s locally)
  a.thumb = still;
  const back = road.bodyOf('device:a');
  if (back === undefined) throw new Error('A stands on the road');
  back.resetPose({ x: -(CHUNK_HALF + 6), y: back.position.y + 1, z: 0 }, -Math.PI / 2);
  a.thumb = run(-Math.PI / 2);
  await vi.waitFor(() => { expect(home.holds('device:a'), `A back into Driftwood from x ${String(road.bodyOf('device:a')?.position.x.toFixed(2))}`).toBe(true); }, { timeout: 30_000, interval: 100 });
  expect(a.closed, 'one socket throughout').toBeNull();
  expect(b.closed, 'one socket throughout').toBeNull();
});
