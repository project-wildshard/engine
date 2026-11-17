import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { ARRIVAL_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { connectOnline, type OnlineShell } from '../src/client/host/online/shell';
import { roomBench, serverInput, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb } from './fixtures/dedicated/roomBot';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';

// ZONE-ENTRY ZE10d2 (J352: "same page, same socket"): a world page's gate. At the gate's 0 the page's online shell says `enter`, hears
// `arrive` with the pose past the gate and holds its client (the road's frames name the cell it is leaving); the next session on the
// same page takes the shell over (`rehome`) and says `ready`, and the door seats it past the gate on the socket it already had.
// Staging's 2 workers: Driftwood with Sunscar and Far Reach on one, Nalati alone on the other (dedicated-zone-enter.test.ts).
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', WEST, EAST];
const IDENTITY = { player: 'device:zone', name: 'Zone' }, EDGE = 562.5 - CHUNK_HALF;
let bench: RoomBench | undefined, shell: OnlineShell | undefined, pump: ReturnType<typeof setInterval> | undefined;
const observers: RoomBot[] = [];
afterEach(async () => { for (const bot of observers.splice(0)) bot.drop(); clearInterval(pump); shell?.dispose(); await bench?.close(); bench = undefined; shell = undefined; });

// Each case still boots fresh rooms, native worlds and real sockets. Only the
// verified immutable product inputs are shared; runtime preparation stays fresh.
const inputs = new Map<string, ReturnType<typeof serverInput>>();
function entryBench(options: Parameters<typeof roomBench>[0]): Promise<RoomBench> {
  return roomBench({ ...options, load: slug => {
    let input = inputs.get(slug);
    if (input === undefined) { input = serverInput(slug); inputs.set(slug, input); }
    return input;
  } });
}

/** A seated page at Driftwood, its commands running `yaw` (null stands still), and what the link told it. */
async function seated(): Promise<{ shell: OnlineShell; steer: (yaw: number | null) => void; regrids: string[]; closes: () => number }> {
  if (bench === undefined) throw new Error('the bench first');
  const regrids: string[] = [], cells = new GridAssembly({ developer: false, devserver: false }).cells.map(cell => cell.instance);
  const page = connectOnline({ socket: bench.url, build: 'bench', loaded: HOME, identity: IDENTITY, gridCell: HOME, gridCells: cells },
    { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined, regrid: cell => { regrids.push(cell); } });
  shell = page;
  let yaw: number | null = null, closes = 0;
  pump = setInterval(() => {
    if (page.client.latest === null) return;
    page.client.command({ viewTick: 0, steer: { keyX: 0, keyY: yaw === null ? 0 : 1, stickX: 0, stickY: 0 }, yaw: yaw ?? 0, pitch: 0, buttons: yaw === null ? 0 : NET_BUTTONS.sprint });
    page.client.flush();
  }, 16);
  await page.booted;
  page.ready();
  await vi.waitFor(() => { expect(bench?.room(HOME)?.holds(IDENTITY.player)).toBe(true); expect(page.client.latest).not.toBeNull(); }, { timeout: 20_000 });
  const transport = (page.client as unknown as { transport: { onClose: (listener: () => void) => void } }).transport;
  transport.onClose(() => { closes++; });
  return { shell: page, steer: next => { yaw = next; }, regrids, closes: () => closes };
}

/** Walk across both real boundaries, starting 1 m inside each rather than spending time approaching them. */
async function toGate(side: -1 | 1, steer: (yaw: number | null) => void): Promise<void> {
  const room = bench, home = room?.room(HOME), road = room?.road(roadName(HOME)), body = home?.bodyOf(IDENTITY.player);
  if (room === undefined || home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  body.resetPose({ x: side * (CHUNK_HALF - 1), y: 1, z: 0 }, -side * Math.PI / 2);
  steer(-side * Math.PI / 2);
  await vi.waitFor(() => { expect(road.holds(IDENTITY.player), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  const walker = road.bodyOf(IDENTITY.player);
  if (walker === undefined) throw new Error('the walker stands on the road');
  walker.resetPose({ x: side * (EDGE - 1), y: walker.position.y + 1, z: 0 }, -side * Math.PI / 2);
  await vi.waitFor(() => { expect(side * (road.bodyOf(IDENTITY.player)?.position.x ?? 0), 'into the buffer').toBeGreaterThan(EDGE + 2); }, { timeout: 30_000, interval: 50 });
  steer(null);
}

for (const [to, side, worker] of [[WEST, -1, 'its own worker'], [EAST, 1, 'the other worker']] as const) {
  test(`the page enters ${to} by its gate on ${worker} and the next session is seated past it on the same socket`, { timeout: 180_000 }, async () => {
    bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
    const page = await seated(), road = bench.road(roadName(HOME));
    await toGate(side, page.steer);
    const enter = page.shell.enter;
    if (enter === undefined) throw new Error('a world page\'s shell says enter');
    const at = await enter(to), inX = -side * (CHUNK_HALF - ARRIVAL_DEPTH);
    expect(at?.x, 'the pose past the gate, in the cell\'s own frame').toBeCloseTo(inX, 5);
    expect(at?.z).toBeCloseTo(0, 5);
    expect(road?.entering(IDENTITY.player), 'frozen at the gate').toBe(to);
    // The old session goes; the client hears nothing of the road it is leaving while the next one loads
    // a phone takes seconds to load the cell: longer than the redial's 3 s with no frame, which must not drop the held link
    await new Promise(resolve => { setTimeout(resolve, 4000); });
    expect(page.shell.client.latest, 'held: the road\'s frames are not the next cell\'s').toBeNull();
    expect(road?.holds(IDENTITY.player), 'still on the road while the page loads').toBe(true);
    // The next session takes the shell over and says ready
    page.shell.rehome?.(to);
    page.shell.ready();
    const target = bench.room(to);
    await vi.waitFor(() => { expect(target?.holds(IDENTITY.player), `seated in ${to}`).toBe(true); }, { timeout: 20_000, interval: 50 });
    await vi.waitFor(() => { expect(page.shell.client.latest?.cell, `frames from ${to}`).toBe(cellFrame(to)); }, { timeout: 10_000, interval: 50 });
    const feet = target?.bodyOf(IDENTITY.player)?.position;
    expect(Math.abs((feet?.x ?? Infinity) - inX), 'past the gate, ARRIVAL_DEPTH in').toBeLessThan(1.5);
    expect(page.shell.client.welcome?.cell, 'welcomed into the cell').toBe(cellFrame(to));
    expect(page.regrids, 'the page never re-enters the grid').toEqual([]);
    expect(page.closes(), 'one socket').toBe(0);
  });
}

test('an enter the road refuses answers null, and the page plays on', { timeout: 120_000 }, async () => {
  bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
  const page = await seated();
  const enter = page.shell.enter;
  if (enter === undefined) throw new Error('a world page\'s shell says enter');
  // Standing in Driftwood, never at a gate
  const asked = performance.now();
  expect(await enter(WEST)).toBeNull();
  expect(performance.now() - asked, 'the room refuses before the shell\'s 10 s fallback').toBeLessThan(5000);
  await new Promise(resolve => { setTimeout(resolve, 300); });
  expect(page.shell.client.latest, 'frames still flow').not.toBeNull();
  expect(bench.room(HOME)?.holds(IDENTITY.player)).toBe(true);
  expect(page.closes(), 'one socket').toBe(0);
});

// ZE16's walk on the bench (staging's is ZE22's): B stands on Driftwood's road beside Nalati's gate and C stands in Nalati while A enters
// it by the gate. B sees A frozen (its row never changes) and then gone; C sees A arrive; A keeps its one socket.
test('two others see the entry: B on the road sees A frozen then go, C in Nalati sees A arrive', { timeout: 180_000 }, async () => {
  bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
  const page = await seated(), road = bench.road(roadName(HOME));
  const b = new RoomBot(bench.url, 'bench', 'device:b', 'B'), c = new RoomBot(`${bench.url}${bench.url.includes('?') ? '&' : '?'}chunk=${EAST}`, 'bench', 'device:c', 'C');
  observers.push(b, c);
  expect(await b.arrived()).toBe(true); expect(await c.arrived()).toBe(true);
  await vi.waitFor(() => { expect(bench?.room(EAST)?.holds('device:c'), 'C stands in Nalati').toBe(true); }, { timeout: 20_000, interval: 50 });
  // B steps off Driftwood's east entryway and is placed on the road 6 m short of Nalati's edge, standing still
  const bBody = bench.room(HOME)?.bodyOf('device:b');
  if (bBody === undefined || road === undefined) throw new Error('B stands in Driftwood');
  bBody.resetPose({ x: CHUNK_HALF - 1, y: 1, z: 0 }, -Math.PI / 2);
  b.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:b'), 'B onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  b.thumb = stillThumb;
  const bOnRoad = road.bodyOf('device:b');
  bOnRoad?.resetPose({ x: EDGE - 6, y: bOnRoad.position.y + 1, z: 6 }, -Math.PI / 2);
  await toGate(1, page.steer);
  // A as B and C hear it: a player row that is neither of theirs
  const others = (bot: RoomBot): number[] => [...bot.client.entities.values()].filter(row => row.cls === PLAYER_CLASS && row.handle !== bot.client.welcome?.handle).map(row => row.handle);
  await vi.waitFor(() => { expect(others(b), 'B sees A at the gate').toHaveLength(1); }, { timeout: 10_000, interval: 50 });
  expect(others(c), 'C sees no one in Nalati yet').toHaveLength(0);
  const enter = page.shell.enter;
  if (enter === undefined) throw new Error('a world page\'s shell says enter');
  expect(await enter(EAST)).not.toBeNull();
  // Frozen: A stays in B's view (a frozen body is still drawn to others) and its body does not move for a second
  const [a] = others(b), frozenAt = road.bodyOf(IDENTITY.player)?.position.clone();
  await new Promise(resolve => { setTimeout(resolve, 1300); });
  expect(others(b), 'B still sees A at the gate').toEqual([a]);
  const now = road.bodyOf(IDENTITY.player)?.position;
  expect(Math.hypot((now?.x ?? Infinity) - (frozenAt?.x ?? 0), (now?.z ?? Infinity) - (frozenAt?.z ?? 0)), 'A stands frozen').toBeLessThan(0.05);
  page.shell.rehome?.(EAST);
  page.shell.ready();
  await vi.waitFor(() => { expect(others(b), 'A is gone from B\'s road').toHaveLength(0); }, { timeout: 20_000, interval: 50 });
  await vi.waitFor(() => { expect(others(c), 'C sees A arrive in Nalati').toHaveLength(1); }, { timeout: 20_000, interval: 50 });
  expect(bench.room(EAST)?.holds(IDENTITY.player)).toBe(true);
  expect(page.closes(), 'A kept one socket').toBe(0);
});

test('an entry the door calls off after arrive (no ready in time) lets the hold go and sends the page back to the cell it left', { timeout: 120_000 }, async () => {
  bench = await entryBench({ cells: CELLS, workers: 2, crossing: true, readyMs: 2500 });
  const page = await seated(), road = bench.road(roadName(HOME));
  await toGate(-1, page.steer);
  expect(await page.shell.enter?.(WEST)).not.toBeNull();
  expect(page.shell.client.latest, 'held').toBeNull();
  // the next session never says ready: the door refuses on its own wait and the body plays on at the gate
  await vi.waitFor(() => { expect(page.regrids, 'back to Driftwood, where the body stands').toEqual([HOME]); }, { timeout: 15_000, interval: 50 });
  expect(road?.entering(IDENTITY.player)).toBeNull();
  await vi.waitFor(() => { expect(page.shell.client.latest, 'frames decode again').not.toBeNull(); }, { timeout: 5000, interval: 50 });
  expect(bench.room(WEST)?.holds(IDENTITY.player), 'never moved into Sunscar').toBe(false);
});

test('a redial between arrive and the next session\'s ready still arrives past the gate, with no re-entry', { timeout: 180_000 }, async () => {
  bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
  const page = await seated();
  await toGate(1, page.steer);
  expect(await page.shell.enter?.(EAST)).not.toBeNull();
  // the link drops while the page loads the cell: the redial's `resume` names Nalati (ZE9c), the page's cell already
  const transport = (page.shell.client as unknown as { transport: { close: (reason?: string) => void } }).transport;
  transport.close('stalled');
  await new Promise(resolve => { setTimeout(resolve, 3000); });
  expect(page.regrids, 'the redial names the cell the page is entering').toEqual([]);
  expect(bench.room(EAST)?.holds(IDENTITY.player), 'not seated before the next session says ready').toBe(false);
  page.shell.rehome?.(EAST);
  page.shell.ready();
  await vi.waitFor(() => { expect(bench?.room(EAST)?.holds(IDENTITY.player), 'seated in Nalati').toBe(true); }, { timeout: 20_000, interval: 50 });
  await vi.waitFor(() => { expect(page.shell.client.latest?.cell).toBe(cellFrame(EAST)); }, { timeout: 10_000, interval: 50 });
  expect(page.regrids).toEqual([]);
});
