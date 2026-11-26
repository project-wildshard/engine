import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { RoomBot, stillThumb } from './fixtures/dedicated/roomBot';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import { CELLS, EAST, EDGE, HOME, IDENTITY, WEST, createEntryFixture } from './fixtures/online-zone-entry';

const { entryBench, seated, toGate, observers, close } = createEntryFixture();
afterEach(close);

// ZE16's walk on the bench (staging's is ZE22's): B stands on Driftwood's road beside Nalati's gate and C stands in Nalati while A enters
// it by the gate. B sees A frozen (its row never changes) and then gone; C sees A arrive; A keeps its one socket.
test('two others see the entry: B on the road sees A frozen then go, C in Nalati sees A arrive', { timeout: 180_000 }, async () => {
  const bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
  const page = await seated(), road = bench.road(roadName(HOME));
  const b = new RoomBot(bench.url, 'bench', 'device:b', 'B'), c = new RoomBot(bench.url, 'bench', 'device:c', 'C', 0, 0, { cell: EAST, spawn: false });
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
  const bench = await entryBench({ cells: CELLS, workers: 2, crossing: true, readyMs: 2500 });
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
  const bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
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
