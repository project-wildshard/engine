import { afterEach, expect, test, vi } from 'vitest';
import { cellName, forgetPlacedCells, placeCell, placedHash, type PlacedCell } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, serverInput, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// Mini QA 2026-11-16 row 75 (NEW-SHARD-E2E F48): a new upload of a shard whose cell is already open moved the cell's hash on every
// worker (SP20 activation), but a grid cell never starts over (SC5), so its room kept the old upload's rules until a box restart while
// the page loaded the new one. A cell whose hash moved past the one its world booted from now starts over on the new upload at its
// first moment with no live seat: at once when empty, else when its last live player goes. A held seat (a page reloading) is let go
// with its save written, as its hold running out would, so the reload seats in the new world. A live player is never cut off.
const PLACED: PlacedCell = { instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [0, 3] };
const OLD = 'a'.repeat(64), NEW = 'b'.repeat(64), NEWER = 'c'.repeat(64);
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; forgetPlacedCells(); });

test('F48: a new upload reaches its already-open cell: a live player keeps the old world, the cell starts over on the new one once nobody live is in it', { timeout: 120_000 }, async () => {
  const home = cellName('open-plot-night-market'), loaded: (string | undefined)[] = [];
  // As `cellWorker.ts` loads a room: by the hash its placement names now.
  bench = await roomBench({ cells: [home], workers: 1, saves: memoryPlayerSaves(), load: slug => { if (slug === PLACED.slug) loaded.push(placedHash(slug)); return serverInput(slug); } });
  const upload = async (hash: string): Promise<void> => { placeCell({ ...PLACED, hash }); await bench?.world.activateCells([PLACED.instance]); };
  await upload(OLD);
  expect(loaded).toEqual([OLD]);
  const first = bench.room(PLACED.instance);

  const author = bot(bench.url, 'bench', 'device:author', 'Bot', 0, 0, { cell: PLACED.instance, spawn: false });
  expect(await author.arrived()).toBe(true);
  await upload(NEW);
  await new Promise(resolve => { setTimeout(resolve, 1000); });
  expect([loaded, bench.room(PLACED.instance)], 'a live player is never cut off').toEqual([[OLD], first]);
  expect(author.closed).toBeNull();

  // The author's page reloads on the new upload: its old socket drops (the seat is held), and the new page dials in.
  author.drop();
  await vi.waitFor(() => { expect(loaded, 'the held seat no longer pins the old world').toEqual([OLD, NEW]); }, { timeout: 10_000, interval: 50 });
  const reloaded = bot(bench.url, 'bench', 'device:author', 'Bot', 0, 0, { cell: PLACED.instance, spawn: false });
  expect(await reloaded.arrived()).toBe(true);
  const second = bench.room(PLACED.instance);
  expect(second).not.toBe(first);
  expect(second?.holds('device:author'), 'seated in the new world').toBe(true);

  // A cell with only a held seat in it takes the next upload at once.
  reloaded.drop();
  await vi.waitFor(() => { expect(second?.holding).toBe(1); }, { timeout: 10_000, interval: 50 });
  await upload(NEWER);
  await vi.waitFor(() => { expect(loaded).toEqual([OLD, NEW, NEWER]); }, { timeout: 10_000, interval: 50 });
  expect([bench.restarts, bench.crashes]).toEqual([0, []]);
});
