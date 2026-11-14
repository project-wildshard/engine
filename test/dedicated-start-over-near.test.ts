import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC4: the server has a neighbour awake before the player arrives. Since J320 every cell is resident from the worker's
// boot and sleeping is only not ticking, so the one boot left on the way is a start-over (J107: a cell everyone left starts over once
// it has stood empty). A walker who steps out onto the road and turns back met that boot at the line (staging logs single
// `cell.booted` lines mid-session). A cell does not start over while a road walker is within reach of its edge. SERVER-CELLS SC5
// (J328) then retired the start-over for every grid cell: its world stays resident and refills by its own respawns, so a grid cell
// never boots again, near walker or far (a cell the grid doesn't place, a local run's WORLD_CELLS, still starts over).
const HOME = 'driftwood-isle', CELLS = [HOME, 'far-reach', 'sunscar-dunes', 'nalati-grasslands'];
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });
const boots = (b: RoomBench, slug: string): number => b.lines.filter(line => line['at'] === 'cell.booted' && line['slug'] === slug).length;

test('a cell left empty does not start over while its walker stands on the road beside it', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, emptyMs: 300 });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot on one worker');
  const booted = boots(bench, HOME);
  // Out of Driftwood's south entryway onto the road, then standing 6 m past the edge.
  body.resetPose({ x: 0, y: 1, z: -(CHUNK_HALF - 5) }, 0);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.z ?? 0, 'on the road past the edge').toBeLessThan(-(CHUNK_HALF + 6)); }, { timeout: 20_000, interval: 50 });
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  await sleep(3000);
  expect(boots(bench, HOME), 'no start-over while the walker stands beside it').toBe(booted);
  // Turning back walks straight in, no boot on the way.
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 20_000, interval: 50 });
  expect(boots(bench, HOME), 'and none on the way in').toBe(booted);
});

test('SC5 (J328): a grid cell left empty never starts over, even once its walker is far from it', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, emptyMs: 300 });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot on one worker');
  const booted = boots(bench, HOME);
  body.resetPose({ x: 0, y: 1, z: -(CHUNK_HALF - 5) }, 0);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  // Out past the reach (into Far Reach since its rev 3 docks, or held on the road): Driftwood stood empty 10x its 300 ms and stays as it is
  await vi.waitFor(() => { expect(home.holds('device:a'), 'gone from Driftwood').toBe(false); }, { timeout: 20_000, interval: 50 });
  await sleep(3000);
  expect(boots(bench, HOME), 'a grid cell never starts over (SC5)').toBe(booted);
});
