import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { playerVehicle, vehicleDockPrompt, vehicleSeatRow } from '../src/shared/game/shardfile/wirePrompts';
import { folderInput, roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { vehiclesExampleFolder } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ19: vehicles are not saved (a dock makes them); a player's vehicle kinds and colours unlocked and the kind
// they last picked at a dock are, in their own SaveStore document. A bot takes the example's buggy at its dock (which picks the
// salt buggy), is given the land-sail and a red buggy, drives 20 m off and drops while seated. Once its seat is let go and its doc
// written, it comes back: on foot beside the buggy's dock, with both kinds, the red, and the buggy as its last pick.
const HOME = 'driftwood-isle', BUGGY = 'yard.buggy', DOCK = { x: -6, z: 20 }, DEVICE = 'device:garage';
let folder: ReturnType<typeof vehiclesExampleFolder>, bench: RoomBench | undefined;
const bots: RoomBot[] = [];
beforeAll(() => { folder = vehiclesExampleFolder(); });
afterAll(() => { folder.dispose(); });
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('unlocks and the last kind picked hold over a reconnect, and a rider comes back on foot at the dock', { timeout: 150_000 }, async () => {
  const saves = memoryPlayerSaves();
  bench = await roomBench({ cells: [HOME], workers: 1, load: () => folderInput(folder.directory), saves, holdMs: 50 });
  const first = new RoomBot(bench.url, 'bench', DEVICE, 'Garage'); bots.push(first);
  expect(await first.arrived()).toBe(true);
  const room = bench.room(HOME); if (room === undefined) throw new Error('The cell did not boot');
  const body = room.bodyOf(DEVICE); if (body === undefined) throw new Error('No body for the bot');
  const rows = shardRows(room.host), buggy = playerVehicle(BUGGY, body.id), garage = room.cell.owned.of(body.id).garage;
  expect(garage.all).toEqual([]); expect(garage.last).toBeNull();
  body.resetPose({ x: DOCK.x, y: 1, z: DOCK.z + 1 }, 0);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  first.client.act({ kind: 'interact', seq: 0, id: vehicleDockPrompt(BUGGY) });
  const seats = (): string[] => [...rows.world.get('vehicles')?.() ?? []].map(row => row.name).filter(name => name.startsWith('vehicle.seat|'));
  await vi.waitFor(() => { expect(seats()).toEqual([vehicleSeatRow(buggy, 0, body.id)]); }, { timeout: 10_000, interval: 50 });
  expect(garage.last).toBe('salt.buggy'); // taking the wheel at a dock is the pick
  expect(garage.unlock('salt.land-sail')).toBe(true); expect(garage.unlockColour('salt.buggy', 'red')).toBe(true);
  expect(garage.unlock('salt.land-sail')).toBe(false); // once
  // drive off: a left turn to face -x, then on until 20 m from the dock
  const pose = (): { x: number; z: number } => { const at = rows.bodies.get(`script:${buggy}`)?.().position; if (at === undefined) throw new Error('The buggy left'); return { x: at.x, z: at.z }; };
  const heading = (): number => rows.bodies.get(`script:${buggy}`)?.().euler.y ?? 0;
  first.thumb = () => ({ viewTick: 0, steer: { keyX: Math.max(-1, Math.min(1, -2 * (Math.PI / 2 - heading()))), keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  await vi.waitFor(() => { const at = pose(); expect(Math.hypot(at.x - DOCK.x, at.z - DOCK.z)).toBeGreaterThan(20); }, { timeout: 30_000, interval: 50 });
  // drop while seated: the seat is let go after the hold, and the doc is written
  first.drop();
  await vi.waitFor(() => { expect(room.bodyOf(DEVICE)).toBeUndefined(); }, { timeout: 10_000, interval: 50 });
  expect(await saves.drain(5000)).toBe(true);
  await vi.waitFor(() => { expect(bench?.world.health().players).toBe(0); }, { timeout: 10_000, interval: 50 });
  const read = await saves.read(DEVICE, HOME);
  expect(read.doc).not.toBeNull();
  expect(Object.values(read.doc?.store ?? {}).some(text => text.includes('"vehicles"'))).toBe(true); // in their own store document
  // back: on foot beside the dock, with what they unlocked and picked
  const back = new RoomBot(bench.url, 'bench', DEVICE, 'Garage'); bots.push(back);
  expect(await back.arrived()).toBe(true);
  const again = room.bodyOf(DEVICE); if (again === undefined) throw new Error('No body on the way back');
  expect(Math.hypot(again.position.x - DOCK.x, again.position.z - DOCK.z)).toBeLessThan(4);
  expect(again.led).toBe(false);
  expect(seats()).toEqual([]);
  const kept = room.cell.owned.of(again.id).garage;
  expect([...kept.all].sort()).toEqual(['salt.buggy', 'salt.land-sail']);
  expect(kept.colours('salt.buggy')).toEqual(['red']);
  expect(kept.last).toBe('salt.buggy');
});
