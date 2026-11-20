import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { VEHICLE_EDGE } from '../src/shared/engine/sim/vehicleHull';
import { roadName } from '../src/server/host/dedicated/gridCells';
import type { WorkerReading } from '../src/server/host/dedicated/cellProtocol';
import { hostVehicles, VEHICLE_CAP } from '../src/server/game/plugin/vehicleRuntime';
import { playerVehicle, vehicleDockPrompt, vehicleSeatRow } from '../src/shared/game/shardfile/wirePrompts';
import { folderInput, roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, type BotThumb } from './fixtures/dedicated/roomBot';
import { vehiclesExampleFolder } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ18: the MMO server's vehicles. A dedicated cell on the grid (its road room up) turns a buggy driven at its
// west edge back `VEHICLE_EDGE` m short of it: the driver never reaches the road, and the road room runs no vehicles. And the
// cell bench: 16 bots each take their own buggy and drive circles in one cell for 15 s; the worker's tick p95 holds under the
// box probe's 12 ms line (SC3, engine docs/vps-setup.md), with every vehicle under `VEHICLE_CAP`.
const HOME = 'driftwood-isle', BUGGY = 'yard.buggy', DOCK = { x: -6, z: 20 }, BOX_TICK_P95_MS = 12;
let folder: ReturnType<typeof vehiclesExampleFolder>, bench: RoomBench | undefined;
const bots: RoomBot[] = [];
beforeAll(() => { folder = vehiclesExampleFolder(); });
afterAll(() => { folder.dispose(); });
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
const steer = (heading: () => number, yaw: () => number, throttle: number): BotThumb => () =>
  ({ viewTick: 0, steer: { keyX: clamp(-2 * wrap(yaw() - heading())), keyY: throttle, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });

test('a buggy driven at the cell\'s west edge stops short of the road, its driver seated in the cell', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: [HOME], workers: 1, crossing: true, load: () => folderInput(folder.directory) });
  const bot = new RoomBot(bench.url, 'bench', 'device:driver', 'Driver'); bots.push(bot);
  expect(await bot.arrived()).toBe(true);
  const room = bench.room(HOME), road = bench.road(roadName(HOME)); if (room === undefined || road === undefined) throw new Error('The cell and its road did not boot');
  const body = room.bodyOf('device:driver'); if (body === undefined) throw new Error('No body for the bot');
  const rows = shardRows(room.host), buggy = playerVehicle(BUGGY, body.id);
  body.resetPose({ x: DOCK.x, y: 1, z: DOCK.z + 1 }, 0);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  bot.client.act({ kind: 'interact', seq: 0, id: vehicleDockPrompt(BUGGY) });
  await vi.waitFor(() => { expect(rows.bodies.has(`script:${buggy}`)).toBe(true); }, { timeout: 10_000, interval: 50 });
  const pose = () => { const read = rows.bodies.get(`script:${buggy}`); if (read === undefined) throw new Error('The buggy left'); return read(); };
  // the example's own ground ends inside the cell: set the buggy down 30 m from the west edge, facing it, and drive on
  hostVehicles(room.host)?.place(buggy, { x: -(CHUNK_HALF - 30), y: 0, z: DOCK.z }, Math.PI / 2);
  bot.thumb = steer(() => pose().euler.y, () => Math.PI / 2, 1); // face -x, full on, at the west edge
  let west = 0;
  await vi.waitFor(() => { west = Math.min(west, pose().position.x); expect(west).toBeLessThan(-(CHUNK_HALF - VEHICLE_EDGE) + 1); }, { timeout: 20_000, interval: 50 });
  for (let i = 0; i < 20; i++) { await new Promise(resolve => { setTimeout(resolve, 100); }); west = Math.min(west, pose().position.x); } // pressing on against it
  expect(west).toBeGreaterThanOrEqual(-(CHUNK_HALF - VEHICLE_EDGE) - 1e-6);
  expect(road.holds('device:driver')).toBe(false);
  expect([...rows.world.get('vehicles')?.() ?? []].map(row => row.name)).toContain(vehicleSeatRow(buggy, 0, body.id));
  expect(shardRows(road.host).world.has('vehicles')).toBe(false); // a road room runs no vehicles
});

test('the cell bench: 16 bots drive their own buggies and the tick p95 holds under the box\'s line', { timeout: 240_000 }, async () => {
  const readings: WorkerReading[] = [];
  let measuring = false;
  bench = await roomBench({ cells: [HOME], workers: 1, readingMs: 1000, socketsPerIp: 32, connectsPerMinute: 64, load: () => folderInput(folder.directory), reading: (_index, row) => { if (measuring) readings.push(row); } });
  const room = bench.room(HOME); if (room === undefined) throw new Error('The cell did not boot');
  const rows = shardRows(room.host);
  const pose = (id: string) => rows.bodies.get(`script:${id}`)?.();
  const clearDock = (): boolean => [...rows.bodies.keys()].filter(key => key.startsWith(`script:${BUGGY}:`)).every(key => { const p = rows.bodies.get(key)?.().position; return p === undefined || Math.hypot(p.x - DOCK.x, p.z - DOCK.z) > 8; });
  for (let i = 0; i < 16; i++) {
    const bot = new RoomBot(bench.url, 'bench', `device:d${String(i)}`, `D${String(i)}`); bots.push(bot);
    const arrived = await bot.arrived(); if (!arrived) throw new Error(`bot ${String(i)} closed: ${String(bot.closed)}; crashes ${JSON.stringify(bench.crashes)}`);
    const body = room.bodyOf(`device:d${String(i)}`); if (body === undefined) throw new Error('No body for a bot');
    // each drives out to its own spot on the open side (west and south of the dock, away from the sail's dock east of it), and circles there
    const buggy = playerVehicle(BUGGY, body.id), angle = Math.PI / 2 + Math.PI / 2 * i / 15, reach = 30 + 3 * i, spot = { x: DOCK.x + reach * Math.cos(angle), z: DOCK.z + reach * Math.sin(angle) };
    await vi.waitFor(() => { expect(clearDock(), `bot ${String(i)}: ${JSON.stringify([...rows.bodies].filter(([key]) => key.includes(BUGGY)).map(([key, read]) => [key.slice(-12), Math.round(read().position.x), Math.round(read().position.z), Number(read().euler.y.toFixed(2))]))}`).toBe(true); }, { timeout: 20_000, interval: 100 });
    body.resetPose({ x: DOCK.x, y: 1, z: DOCK.z + 1 }, 0);
    await new Promise(resolve => { setTimeout(resolve, 150); });
    bot.client.act({ kind: 'interact', seq: 0, id: vehicleDockPrompt(BUGGY) });
    await vi.waitFor(() => { expect(pose(buggy)).toBeDefined(); }, { timeout: 10_000, interval: 50 });
    const out = steer(() => pose(buggy)?.euler.y ?? 0, () => { const p = pose(buggy)?.position ?? { x: 0, z: 0 }; return Math.atan2(-(spot.x - p.x), -(spot.z - p.z)); }, 0.7);
    bot.thumb = tick => { const p = pose(buggy)?.position; return p !== undefined && Math.hypot(p.x - spot.x, p.z - spot.z) < 12 ? { ...out(tick), steer: { keyX: -1, keyY: 0.5, stickX: 0, stickY: 0 } } : out(tick); };
  }
  const out = [...rows.bodies.keys()].filter(key => key.startsWith('script:') && (key.includes(BUGGY) || key.includes('line.sail')));
  expect(out.length).toBe(17); // 16 buggies and the shared sail
  expect(out.length).toBeLessThanOrEqual(VEHICLE_CAP);
  measuring = true;
  await new Promise(resolve => { setTimeout(resolve, 15_500); });
  measuring = false;
  const awake = readings.filter(row => row.awake > 0 && row.ticks > 0);
  expect(awake.length).toBeGreaterThanOrEqual(10);
  const worst = Math.max(...awake.map(row => row.p95));
  console.info(JSON.stringify({ at: 'vehicle-cell-bench', vehicles: out.length, readings: awake.length, p95MaxMs: Number(worst.toFixed(2)), p50MaxMs: Number(Math.max(...awake.map(row => row.p50)).toFixed(2)), frameBytes: awake.reduce((sum, row) => sum + row.frameBytes, 0) }));
  expect(worst).toBeLessThan(BOX_TICK_P95_MS);
});
