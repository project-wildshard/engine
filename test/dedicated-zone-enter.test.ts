import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { decodeArrive, decodeEnter, encodeEnter, type ArriveWord, type EnterWord } from '../src/shared/engine/net/socketFrames';
import { ARRIVAL_DEPTH, BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb, type BotThumb } from './fixtures/dedicated/roomBot';

// ZONE-ENTRY ZE9a (J352): a cell is entered by its gate. At the gate's 0 the page says `enter` {cell}; the road takes it only from a
// seat standing in that cell's buffer, never into its home, and freezes the body (its inputs dropped, nothing moves it). Staging's
// 2 workers put Nalati alone on one and Driftwood with Sunscar and Far Reach on the other; Sunscar is Driftwood's west neighbour.
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', WEST, EAST];
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

/** A bot that hears the door's `enter` and `arrive` words, and says `enter`. */
function listen(bot: RoomBot): { readonly answers: EnterWord[]; readonly arrivals: ArriveWord[]; readonly enter: (cell: string) => void; readonly closes: () => number } {
  const answers: EnterWord[] = [], arrivals: ArriveWord[] = [];
  let closes = 0;
  bot.transport.onControl((control, bytes) => {
    if (control === 'enter') { const word = decodeEnter(bytes); if (word !== null) answers.push(word); }
    if (control === 'arrive') { const word = decodeArrive(bytes); if (word !== null) arrivals.push(word); }
  });
  bot.transport.onClose(() => { closes++; });
  return { answers, arrivals, enter: cell => { bot.transport.control('enter', encodeEnter({ cell })); }, closes: () => closes };
}
/** From Driftwood's entryway on `side` (-1 west to Sunscar, +1 east to Nalati) out along the road and into the cell's buffer, held at its gate. */
async function toGate(room: RoomBench, bot: RoomBot, side: -1 | 1): Promise<NonNullable<ReturnType<RoomBench['road']>>> {
  const home = room.room(HOME), road = room.road(roadName(HOME)), body = home?.bodyOf('device:a'), edge = 562.5 - CHUNK_HALF;
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  body.resetPose({ x: side * (CHUNK_HALF - 5), y: 1, z: 0 }, -side * Math.PI / 2);
  bot.thumb = run(-side * Math.PI / 2);
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  await vi.waitFor(() => { expect(side * (road.bodyOf('device:a')?.position.x ?? 0), 'into the buffer').toBeGreaterThan(edge + 2); }, { timeout: 30_000, interval: 50 });
  return road;
}

for (const [to, side, worker] of [[WEST, -1, 'its own worker'], [EAST, 1, 'the other worker']] as const) {
  test(`enter, arrive and ready move the walker past ${to}'s gate on ${worker}, on one socket`, { timeout: 180_000 }, async () => {
    bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
    const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
    expect(await a.arrived()).toBe(true);
    const heard = listen(a), road = await toGate(bench, a, side);
    heard.enter(to);
    await vi.waitFor(() => { expect(heard.arrivals).toHaveLength(1); }, { timeout: 5000, interval: 20 });
    // The pose past the gate, in the cell's own frame: the entryway's centre line, ARRIVAL_DEPTH in, facing in
    const [arrive] = heard.arrivals, inX = -side * (CHUNK_HALF - ARRIVAL_DEPTH);
    expect(arrive?.cell).toBe(to);
    expect(arrive?.at.x).toBeCloseTo(inX, 5); expect(arrive?.at.z).toBeCloseTo(0, 5); expect(arrive?.at.yaw).toBeCloseTo(Math.atan2(inX, 0), 5);
    // Loading: frozen on the road until the page says ready
    expect(road.entering('device:a')).toBe(to);
    a.thumb = stillThumb;
    await new Promise(resolve => { setTimeout(resolve, 500); });
    expect(road.holds('device:a'), 'still on the road while the page loads').toBe(true);
    a.transport.control('ready');
    const target = bench.room(to);
    if (target === undefined) throw new Error(`${to} boots`);
    await vi.waitFor(() => { expect(target.holds('device:a'), `seated in ${to}`).toBe(true); }, { timeout: 20_000, interval: 50 });
    const feet = target.bodyOf('device:a')?.position;
    expect(Math.abs((feet?.x ?? Infinity) - inX), 'past the gate, ARRIVAL_DEPTH in').toBeLessThan(1.5);
    expect(Math.abs(feet?.z ?? Infinity), 'on the entryway\'s centre line').toBeLessThan(1.5);
    expect(road.holds('device:a'), 'off the road').toBe(false);
    await vi.waitFor(() => { expect(a.client.latest?.cell, `frames from ${to}`).toBe(cellFrame(to)); }, { timeout: 10_000, interval: 50 });
    expect(heard.answers, 'nothing refused').toEqual([]);
    expect(heard.closes(), 'one socket').toBe(0);
  });
}

test('a page that never says ready in time: the freeze lifts in the buffer and the walker plays on', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, readyMs: 4000 });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const heard = listen(a), road = await toGate(bench, a, -1);
  heard.enter(WEST);
  await vi.waitFor(() => { expect(heard.arrivals).toHaveLength(1); }, { timeout: 5000, interval: 20 });
  expect(road.entering('device:a')).toBe(WEST);
  await vi.waitFor(() => { expect(heard.answers).toEqual([{ cell: WEST, refused: 'timeout' }]); }, { timeout: 10_000, interval: 50 });
  await vi.waitFor(() => { expect(road.entering('device:a'), 'the freeze lifts').toBeNull(); }, { timeout: 5000, interval: 20 });
  const x = road.bodyOf('device:a')?.position.x ?? 0;
  a.thumb = run(-Math.PI / 2);
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? -Infinity, 'walks back east out of the buffer').toBeGreaterThan(x + 3); }, { timeout: 10_000, interval: 50 });
  expect(bench.room(WEST)?.holds('device:a'), 'never moved into Sunscar').toBe(false);
  expect(heard.closes(), 'one socket').toBe(0);
});
