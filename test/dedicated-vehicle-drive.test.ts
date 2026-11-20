import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { playerVehicle, vehicleDockPrompt, vehicleLeavePrompt, vehicleMotionRow, vehicleSeatRow } from '../src/shared/game/shardfile/wirePrompts';
import { folderInput, roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, type BotThumb } from './fixtures/dedicated/roomBot';
import { vehiclesExampleFolder } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ9b: a dedicated cell runs `world/vehicles` for a player over real sockets. A bot stands at the vehicles
// example's buggy dock (-6, 0, 20, facing -z), presses its prompt (the server spawns the bot's own buggy and seats it to drive),
// holds forward until the buggy is 20 m from its dock, and gets out: its body is set down beside the buggy and walks again.
const HOME = 'driftwood-isle', BUGGY = 'yard.buggy', DOCK = { x: -6, z: 20 };
let folder: ReturnType<typeof vehiclesExampleFolder>, bench: RoomBench | undefined;
const bots: RoomBot[] = [];
beforeAll(() => { folder = vehiclesExampleFolder(); });
afterAll(() => { folder.dispose(); });
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

const hold = (keyY: number, yaw = 0): BotThumb => () => ({ viewTick: 0, steer: { keyX: 0, keyY, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 });

test('a bot boards the example buggy at its dock, drives it 20 m and gets out', { timeout: 150_000 }, async () => {
  bench = await roomBench({ cells: [HOME], workers: 1, load: () => folderInput(folder.directory) });
  const bot = new RoomBot(bench.url, 'bench', 'device:driver', 'Driver'); bots.push(bot);
  expect(await bot.arrived()).toBe(true);
  const room = bench.room(HOME); if (room === undefined) throw new Error('The cell did not boot');
  const body = room.bodyOf('device:driver'); if (body === undefined) throw new Error('No body for the bot');
  const host = room.host, rows = shardRows(host), buggy = playerVehicle(BUGGY, body.id);
  body.resetPose({ x: DOCK.x, y: 1, z: DOCK.z + 1 }, 0);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  // its prompt, over the reliable lane: the server spawns this player's buggy and seats them to drive
  bot.client.act({ kind: 'interact', seq: 0, id: vehicleDockPrompt(BUGGY) });
  await vi.waitFor(() => { expect(rows.bodies.has(`script:${buggy}`)).toBe(true); }, { timeout: 10_000, interval: 50 });
  const seats = (): string[] => [...rows.world.get('vehicles')?.() ?? []].map(row => row.name).filter(name => name.startsWith('vehicle.seat|'));
  await vi.waitFor(() => { expect(seats()).toEqual([vehicleSeatRow(buggy, 0, body.id)]); }, { timeout: 5_000, interval: 50 });
  // the bot's own client hears its rows: the pose, the seat and (MSZ16) the speeds its page replays from
  await vi.waitFor(() => {
    expect(bot.client.handle(`script:${buggy}`)).toBeDefined(); expect(bot.client.handle(`state:${vehicleSeatRow(buggy, 0, body.id)}`)).toBeDefined();
    expect(bot.client.handle(`state:${vehicleMotionRow(buggy, 'forward')}`)).toBeDefined(); expect(bot.client.handle(`state:${vehicleMotionRow(buggy, 'slip')}`)).toBeDefined();
  }, { timeout: 5_000, interval: 50 });
  const pose = (): { x: number; z: number } => { const read = rows.bodies.get(`script:${buggy}`); if (read === undefined) throw new Error('The buggy left'); const at = read().position; return { x: at.x, z: at.z }; };
  // MSZ12: the driver's stick is the vehicle's own (forward throttles, the side turns, whichever way the driver looks): forward
  // and a left turn until the buggy faces -x (yaw pi/2), then straight on until it stands 20 m from its dock (the slice's wall
  // 10 m ahead of the dock would stop a straight run); the seated body rides along
  const heading = (): number => rows.bodies.get(`script:${buggy}`)?.().euler.y ?? 0;
  bot.thumb = () => ({ viewTick: 0, steer: { keyX: Math.max(-1, Math.min(1, -2 * (Math.PI / 2 - heading()))), keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  await vi.waitFor(() => { const at = pose(); expect(Math.hypot(at.x - DOCK.x, at.z - DOCK.z)).toBeGreaterThan(20); }, { timeout: 30_000, interval: 50 });
  const driven = pose();
  expect(driven.x).toBeLessThan(DOCK.x - 12); // it went the way the stick said
  expect(Math.hypot(body.position.x - driven.x, body.position.z - driven.z)).toBeLessThan(2); // and the driver with it
  expect(body.led).toBe(true);
  bot.thumb = hold(0);
  // let go of the stick: it coasts to a stop (`VEHICLE_COAST`, 1.5 m/s²)
  let was = { x: Infinity, z: Infinity };
  await vi.waitFor(() => { const at = pose(), still = Math.hypot(at.x - was.x, at.z - was.z) < 0.01; was = at; expect(still).toBe(true); }, { timeout: 30_000, interval: 500 });
  // get out: set down on the driver's side, on foot
  bot.client.act({ kind: 'interact', seq: 1, id: vehicleLeavePrompt(buggy) }); // a new seq: an act a seq has carried is not acted again
  await vi.waitFor(() => { expect(seats()).toEqual([]); }, { timeout: 5_000, interval: 50 });
  expect(body.carried).toBe(false);
  const out = pose();
  expect(Math.hypot(body.position.x - out.x, body.position.z - out.z)).toBeGreaterThan(1);
  expect(Math.hypot(body.position.x - out.x, body.position.z - out.z)).toBeLessThan(4);
  // and walks again, away from the buggy: forward moves the body, not the buggy (forward is (-sin yaw, -cos yaw))
  const from = { x: body.position.x, z: body.position.z };
  bot.thumb = hold(1, Math.atan2(-(from.x - out.x), -(from.z - out.z)));
  await vi.waitFor(() => { expect(Math.hypot(body.position.x - from.x, body.position.z - from.z)).toBeGreaterThan(1); }, { timeout: 5_000, interval: 50 });
  expect(Math.hypot(pose().x - out.x, pose().z - out.z)).toBeLessThan(1.5);
});
