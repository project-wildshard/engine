import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { decodeEnter, encodeEnter, type EnterWord } from '../src/shared/engine/net/socketFrames';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, type BotThumb } from './fixtures/dedicated/roomBot';

// ZONE-ENTRY ZE9a (J352): a cell is entered by its gate. At the gate's 0 the page says `enter` {cell}; the road takes it only from a
// seat standing in that cell's buffer, never into its home, and freezes the body (its inputs dropped, nothing moves it). Staging's
// 2 workers put Nalati alone on one and Driftwood with Sunscar and Far Reach on the other; Sunscar is Driftwood's west neighbour.
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', CELLS = [HOME, 'far-reach', WEST, 'nalati-grasslands'];
/** Sunscar's east edge in the world's frame on staging's pitch, and its gate. */
const WEST_EDGE = -(562.5 - CHUNK_HALF), WEST_GATE = WEST_EDGE - BUFFER_DEPTH;
/** Running: west is yaw π/2 (the motor faces atan2(own - target)), east -π/2. */
const run = (yaw: number, buttons: number = NET_BUTTONS.sprint): BotThumb => () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons });
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('enter freezes a walker in Sunscar\'s buffer, and is refused short of it and into the home', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  const answers: EnterWord[] = [];
  a.transport.onControl((control, bytes) => { if (control === 'enter') { const word = decodeEnter(bytes); if (word !== null) answers.push(word); } });
  const enter = (cell: string): void => { a.transport.control('enter', encodeEnter({ cell })); };
  let closes = 0;
  a.transport.onClose(() => { closes++; });
  // On Driftwood's west entryway, 5 m inside the edge, running west onto the road
  body.resetPose({ x: -(CHUNK_HALF - 5), y: 1, z: 0 }, Math.PI / 2);
  a.thumb = run(Math.PI / 2);
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'out on the road').toBeLessThan(-(CHUNK_HALF + 3)); }, { timeout: 20_000, interval: 20 });
  // Short of Sunscar's buffer, and into the home: refused, the walker free
  enter(WEST); enter(HOME);
  await vi.waitFor(() => { expect(answers).toHaveLength(2); }, { timeout: 5000, interval: 20 });
  expect(answers).toEqual([{ cell: WEST, refused: 'not-at-gate' }, { cell: HOME, refused: 'home' }]);
  expect(road.entering('device:a')).toBeNull();
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'walked on into Sunscar\'s buffer').toBeLessThan(WEST_EDGE - 2); }, { timeout: 30_000, interval: 50 });
  expect(road.bodyOf('device:a')?.position.x ?? -Infinity, 'held at Sunscar\'s gate').toBeGreaterThan(WEST_GATE);
  // In the buffer: taken, and the body freezes
  enter(WEST);
  await vi.waitFor(() => { expect(road.entering('device:a')).toBe(WEST); }, { timeout: 5000, interval: 20 });
  const frozen = road.bodyOf('device:a');
  if (frozen === undefined) throw new Error('the frozen body stands on the road');
  await new Promise(resolve => { setTimeout(resolve, 200); });
  const still = { x: frozen.position.x, z: frozen.position.z };
  // 3 s of every input: back east at a sprint, then west into the gate with a jump; nothing moves it
  let drift = 0;
  for (const [thumb, ms] of [[run(-Math.PI / 2), 1500], [run(Math.PI / 2, NET_BUTTONS.sprint | NET_BUTTONS.jump), 1500]] as const) {
    a.thumb = thumb;
    for (const ends = Date.now() + ms; Date.now() < ends;) {
      await new Promise(resolve => { setTimeout(resolve, 50); });
      drift = Math.max(drift, Math.hypot(frozen.position.x - still.x, frozen.position.z - still.z));
    }
  }
  expect(drift, 'frozen: inputs move nothing').toBeLessThan(0.05);
  expect(frozen.led, 'led on the wire, so the page predicts no step').toBe(true);
  expect(answers, 'the entry was taken, not refused').toHaveLength(2);
  // A second word while entering is refused; the seat stays frozen on Driftwood's road, on one socket
  enter(WEST);
  await vi.waitFor(() => { expect(answers.at(-1)).toEqual({ cell: WEST, refused: 'entering' }); }, { timeout: 5000, interval: 20 });
  expect(road.entering('device:a')).toBe(WEST);
  expect(road.holds('device:a')).toBe(true);
  expect(closes, 'never redialled').toBe(0);
});
