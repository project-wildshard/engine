import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF, CONTENT_CAPS, ROAD_WIDTH } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import type { PlayerSim } from '../src/server/engine/sim/playerSim';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, type BotThumb } from './fixtures/dedicated/roomBot';

// QA 11-15 row 8 (Jake: "We had agreed upon speeds. I feel like the speeds have changed now that we have an MMO server"): the
// dedicated server's board, by input over real sockets, runs the agreed speeds the page predicts. G39: 14 m/s inside a shard;
// G60: 30 m/s on the road; G540: Developer boost 4x in a shard (56) and 2x on the road (60). Before, a worker's cell and road
// rooms installed no grid cap and refused boost, so every case ran 14 while the page predicted 30, 56 and 60.
const HOME = 'driftwood-isle', CELLS = [HOME, 'sunscar-dunes', 'far-reach', 'nalati-grasslands'];
/** The middle of the road's deck west of Driftwood, in the world's frame (the road room's). */
const DECK_X = -(CHUNK_HALF + (CONTENT_CAPS.pitch - CHUNK_HALF * 2 - ROAD_WIDTH) / 2 + ROAD_WIDTH / 2);
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

const drive = (yaw: number, boost: () => boolean): BotThumb => () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: boost() ? NET_BUTTONS.boost : 0 });
/** The fastest horizontal speed the body reaches in `ms`, sampled every 50 ms. */
async function topSpeed(body: () => PlayerSim | undefined, ms: number): Promise<number> {
  let top = 0;
  for (const ends = performance.now() + ms; performance.now() < ends; await new Promise(resolve => { setTimeout(resolve, 50); })) {
    const v = body()?.velocity; if (v !== undefined) top = Math.max(top, Math.hypot(v.x, v.z));
  }
  return top;
}

test('a worker\'s cell and road run the agreed board speeds, boost off and on', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const cellBot = new RoomBot(bench.url, 'bench', 'device:cell', 'Cell'), roadBot = new RoomBot(bench.url, 'bench', 'device:road', 'Road');
  bots.push(cellBot, roadBot);
  expect(await cellBot.arrived()).toBe(true); expect(await roadBot.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(roadName(HOME));
  if (home === undefined || road === undefined) throw new Error('Driftwood and its road boot on one worker');
  // The road bot walks out of Driftwood's west entryway onto the road (the page's motor faces atan2(own - target): -x is pi/2).
  home.bodyOf('device:road')?.resetPose({ x: -(CHUNK_HALF - 10), y: 1, z: 0 }, Math.PI / 2);
  roadBot.thumb = drive(Math.PI / 2, () => false);
  await vi.waitFor(() => { expect(road.holds('device:road')).toBe(true); }, { timeout: 20_000, interval: 100 });
  // Then both stand on their boards: the cell bot on Driftwood's west water heading +z, the road bot on the deck's middle heading -z.
  let boosted = false;
  const onRoad = (): PlayerSim | undefined => road.bodyOf('device:road'), inCell = (): PlayerSim | undefined => home.bodyOf('device:cell');
  roadBot.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  await new Promise(resolve => { setTimeout(resolve, 200); });
  onRoad()?.resetPose({ x: DECK_X, y: 0.5, z: 240 }, 0); onRoad()?.setBoard(true);
  inCell()?.resetPose({ x: -235, y: 1, z: -150 }, Math.PI); inCell()?.setBoard(true);
  roadBot.thumb = drive(0, () => boosted); cellBot.thumb = drive(Math.PI, () => boosted);
  const [cellCruise, roadCruise] = await Promise.all([topSpeed(inCell, 3000), topSpeed(onRoad, 3000)]);
  boosted = true;
  const [cellBoost, roadBoost] = await Promise.all([topSpeed(inCell, 5500), topSpeed(onRoad, 5500)]);
  const speeds = { cellCruise, roadCruise, cellBoost, roadBoost }, label = JSON.stringify(speeds);
  expect(road.holds('device:road'), `the road bot stays on the road: ${label}`).toBe(true);
  expect(onRoad()?.board.on, label).toBe(true); expect(inCell()?.board.on, label).toBe(true);
  expect(cellCruise, `G39: 14 m/s inside a shard ${label}`).toBeCloseTo(14, 0);
  expect(roadCruise, `G60: 30 m/s on the road ${label}`).toBeCloseTo(30, 0);
  expect(cellBoost, `G540: boost is 4x in a shard ${label}`).toBeCloseTo(56, 0);
  expect(roadBoost, `G540: boost is 2x on the road ${label}`).toBeCloseTo(60, 0);
});
