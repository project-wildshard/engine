import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { ARRIVAL_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { connectOnline, type OnlineShell } from '../src/client/host/online/shell';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';

// ZONE-ENTRY ZE10d2 (J352: "same page, same socket"): a world page's gate. At the gate's 0 the page's online shell says `enter`, hears
// `arrive` with the pose past the gate and holds its client (the road's frames name the cell it is leaving); the next session on the
// same page takes the shell over (`rehome`) and says `ready`, and the door seats it past the gate on the socket it already had.
// Staging's 2 workers: Driftwood with Sunscar and Far Reach on one, Nalati alone on the other (dedicated-zone-enter.test.ts).
const HOME = 'driftwood-isle', WEST = 'sunscar-dunes', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', WEST, EAST];
const IDENTITY = { player: 'device:zone', name: 'Zone' }, EDGE = 562.5 - CHUNK_HALF;
let bench: RoomBench | undefined, shell: OnlineShell | undefined, pump: ReturnType<typeof setInterval> | undefined;
afterEach(async () => { clearInterval(pump); shell?.dispose(); await bench?.close(); bench = undefined; shell = undefined; });

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

/** Off Driftwood's entryway on `side` (-1 west, +1 east) onto its road, then 4 m short of the next cell's edge and on into its buffer. */
async function toGate(side: -1 | 1, steer: (yaw: number | null) => void): Promise<void> {
  const room = bench, home = room?.room(HOME), road = room?.road(roadName(HOME)), body = home?.bodyOf(IDENTITY.player);
  if (room === undefined || home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  body.resetPose({ x: side * (CHUNK_HALF - 5), y: 1, z: 0 }, -side * Math.PI / 2);
  steer(-side * Math.PI / 2);
  await vi.waitFor(() => { expect(road.holds(IDENTITY.player), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  const walker = road.bodyOf(IDENTITY.player);
  if (walker === undefined) throw new Error('the walker stands on the road');
  walker.resetPose({ x: side * (EDGE - 4), y: walker.position.y + 1, z: 0 }, -side * Math.PI / 2);
  await vi.waitFor(() => { expect(side * (road.bodyOf(IDENTITY.player)?.position.x ?? 0), 'into the buffer').toBeGreaterThan(EDGE + 2); }, { timeout: 30_000, interval: 50 });
  steer(null);
}

for (const [to, side, worker] of [[WEST, -1, 'its own worker'], [EAST, 1, 'the other worker']] as const) {
  test(`the page enters ${to} by its gate on ${worker} and the next session is seated past it on the same socket`, { timeout: 180_000 }, async () => {
    bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
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
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const page = await seated();
  const enter = page.shell.enter;
  if (enter === undefined) throw new Error('a world page\'s shell says enter');
  // Standing in Driftwood, never at a gate
  expect(await enter(WEST)).toBeNull();
  await new Promise(resolve => { setTimeout(resolve, 300); });
  expect(page.shell.client.latest, 'frames still flow').not.toBeNull();
  expect(bench.room(HOME)?.holds(IDENTITY.player)).toBe(true);
  expect(page.closes(), 'one socket').toBe(0);
});
