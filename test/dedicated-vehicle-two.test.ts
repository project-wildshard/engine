import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { playerVehicle, vehicleDockPrompt, vehicleSeatPrompt, vehicleSeatRow } from '../src/shared/game/shardfile/wirePrompts';
import { folderInput, roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb, type BotThumb } from './fixtures/dedicated/roomBot';
import { vehiclesExampleFolder } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ17: two players and a passenger in a dedicated cell over real sockets. Amber takes her own buggy from the
// example's player dock (-6, 0, 20, facing -z) and drives it 12 m west; Basil, beside her driver's seat, asks for it and is
// refused (a taken seat), then takes his own buggy from the cleared dock; Cass takes Amber's passenger seat, and a second ask
// for it is refused; Amber drives a full circle with Cass led on her seat the whole way round; then Basil rams Amber's parked
// buggy, which takes the push.
const HOME = 'driftwood-isle', BUGGY = 'yard.buggy', DOCK = { x: -6, z: 20 };
let folder: ReturnType<typeof vehiclesExampleFolder>, bench: RoomBench | undefined;
const bots: RoomBot[] = [];
beforeAll(() => { folder = vehiclesExampleFolder(); });
afterAll(() => { folder.dispose(); });
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
/** The driver's stick: `throttle`, and a turn that swings the heading toward `yaw` (a right turn lowers it). */
const toward = (heading: () => number, yaw: () => number, throttle: number, buttons = 0): BotThumb => () =>
  ({ viewTick: 0, steer: { keyX: clamp(-2 * wrap(yaw() - heading())), keyY: throttle, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons });
const brake: BotThumb = () => ({ ...stillThumb(0), buttons: NET_BUTTONS.brake });
const settle = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

test('two drivers and a passenger: seats are one each, a passenger rides a lap, and two buggies collide', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: [HOME], workers: 1, load: () => folderInput(folder.directory) });
  const [amber, basil, cass] = ['amber', 'basil', 'cass'].map(name => new RoomBot(bench?.url ?? '', 'bench', `device:${name}`, name)) as [RoomBot, RoomBot, RoomBot];
  bots.push(amber, basil, cass);
  for (const bot of [amber, basil, cass]) expect(await bot.arrived()).toBe(true);
  const room = bench.room(HOME); if (room === undefined) throw new Error('The cell did not boot');
  const body = (device: string) => { const found = room.bodyOf(device); if (found === undefined) throw new Error(`No body for ${device}`); return found; };
  const a = body('device:amber'), b = body('device:basil'), c = body('device:cass'), rows = shardRows(room.host);
  const mine = playerVehicle(BUGGY, a.id), his = playerVehicle(BUGGY, b.id);
  const pose = (id: string) => { const read = rows.bodies.get(`script:${id}`); if (read === undefined) throw new Error(`${id} is not out`); return read(); };
  const heading = (id: string) => (): number => pose(id).euler.y;
  const seats = (): string[] => [...rows.world.get('vehicles')?.() ?? []].map(row => row.name).filter(name => name.startsWith('vehicle.seat|')).sort();
  /** A seat's point in the cell: the kind's seat (x right, z back) about the buggy's heading. */
  const seatAt = (id: string, local: readonly [number, number]): { x: number; z: number } => {
    const p = pose(id), cos = Math.cos(p.euler.y), sin = Math.sin(p.euler.y);
    return { x: p.position.x + local[0] * cos + local[1] * sin, z: p.position.z - local[0] * sin + local[1] * cos };
  };
  let seq = 0;
  const press = (bot: RoomBot, id: string): void => { bot.client.act({ kind: 'interact', seq: seq++, id }); };

  // Amber takes her own buggy and drives it 12 m west, then brakes to a stop
  a.resetPose({ x: DOCK.x, y: 1, z: DOCK.z + 1 }, 0); b.resetPose({ x: DOCK.x + 8, y: 1, z: DOCK.z + 6 }, 0); c.resetPose({ x: DOCK.x + 10, y: 1, z: DOCK.z + 6 }, 0);
  await settle(200);
  press(amber, vehicleDockPrompt(BUGGY));
  await vi.waitFor(() => { expect(seats()).toEqual([vehicleSeatRow(mine, 0, a.id)]); }, { timeout: 10_000, interval: 50 });
  amber.thumb = toward(heading(mine), () => Math.PI / 2, 1);
  await vi.waitFor(() => { const p = pose(mine).position; expect(Math.hypot(p.x - DOCK.x, p.z - DOCK.z)).toBeGreaterThan(12); }, { timeout: 30_000, interval: 50 });
  amber.thumb = brake;
  let was = { x: Infinity, z: Infinity };
  await vi.waitFor(() => { const p = pose(mine).position, still = Math.hypot(p.x - was.x, p.z - was.z) < 0.01; was = { x: p.x, z: p.z }; expect(still).toBe(true); }, { timeout: 20_000, interval: 300 });

  // Basil, beside her seat, asks for it: it is taken; then he takes his own from the cleared dock
  const driverSeat = seatAt(mine, [-1.95, 0.3]);
  b.resetPose({ x: driverSeat.x, y: 1, z: driverSeat.z }, 0); await settle(200);
  press(basil, vehicleSeatPrompt(mine, 0)); await settle(500);
  expect(seats()).toEqual([vehicleSeatRow(mine, 0, a.id)]);
  expect(b.led).toBe(false);
  b.resetPose({ x: DOCK.x, y: 1, z: DOCK.z + 1 }, 0); await settle(200);
  press(basil, vehicleDockPrompt(BUGGY));
  await vi.waitFor(() => { expect(seats()).toContain(vehicleSeatRow(his, 0, b.id)); }, { timeout: 10_000, interval: 50 });

  // Cass takes Amber's passenger seat; Basil's later ask for it (from beside it) changes nothing
  const passengerSide = seatAt(mine, [1.95, 0.3]);
  c.resetPose({ x: passengerSide.x, y: 1, z: passengerSide.z }, 0); await settle(200);
  press(cass, vehicleSeatPrompt(mine, 1));
  await vi.waitFor(() => { expect(seats()).toContain(vehicleSeatRow(mine, 1, c.id)); }, { timeout: 10_000, interval: 50 });
  const three = seats();
  expect(three).toHaveLength(3);
  // the passenger's own client hears the seat and the vehicle it rides
  await vi.waitFor(() => { expect(cass.client.handle(`state:${vehicleSeatRow(mine, 1, c.id)}`)).toBeDefined(); expect(cass.client.handle(`script:${mine}`)).toBeDefined(); }, { timeout: 5_000, interval: 50 });

  // a lap: Amber turns a full circle at part throttle, Cass led on the passenger seat the whole way
  let turned = 0, last = pose(mine).euler.y, farthest = 0;
  amber.thumb = () => ({ viewTick: 0, steer: { keyX: -1, keyY: 0.45, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  await vi.waitFor(() => {
    const now = pose(mine).euler.y; turned += wrap(now - last); last = now;
    const seat = seatAt(mine, [0.45, 0.3]); farthest = Math.max(farthest, Math.hypot(c.position.x - seat.x, c.position.z - seat.z));
    expect(c.led).toBe(true);
    expect(Math.abs(turned)).toBeGreaterThan(2 * Math.PI);
  }, { timeout: 40_000, interval: 50 });
  expect(farthest).toBeLessThan(1.5); // led on the seat, a step behind at most
  expect(seats()).toEqual(three);
  amber.thumb = brake;
  was = { x: Infinity, z: Infinity };
  await vi.waitFor(() => { const p = pose(mine).position, still = Math.hypot(p.x - was.x, p.z - was.z) < 0.01; was = { x: p.x, z: p.z }; expect(still).toBe(true); }, { timeout: 20_000, interval: 300 });

  // Basil drives into Amber's parked buggy: it takes the push while she brakes
  const parked = { ...pose(mine).position };
  basil.thumb = toward(heading(his), () => { const me = pose(his).position, at = pose(mine).position; return Math.atan2(-(at.x - me.x), -(at.z - me.z)); }, 1);
  await vi.waitFor(() => { const p = pose(mine).position; expect(Math.hypot(p.x - parked.x, p.z - parked.z)).toBeGreaterThan(0.3); }, { timeout: 30_000, interval: 50 });
  basil.thumb = stillThumb;
  expect(seats()).toEqual(three); // every seat held through the hit
});
