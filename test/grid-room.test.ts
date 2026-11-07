// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimCommand, type SimHost, type SimLevel } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import type { SimSnapshot } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { GridAssembly, type GridCell, type GridPoint } from '../src/shared/game/grid/assembly';
import { GridRoom } from '../src/server/game/grid/room';
import { GridSimulation, type GridResident } from '../src/server/game/grid/simulation';
import type { GridLoadout } from '../src/shared/game/grid/wallet';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3.9: two players walk a real two-world grid on real Rapier, and each crosses at their own moment. The bot's feet drive
// its own GridCrossing; the lead stays behind, or goes on without it. Only the hosts' content is a plain flat level.
const BOT = 'bot:1', level: SimLevel = { ...SIM_LEVEL, entities: [], ground: { size: 3000, height: 0 } };
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

interface Stage { readonly grid: GridSimulation; readonly room: GridRoom; readonly cell: GridCell; readonly hosts: Map<string, SimHost>; readonly saved: Map<string, SimSnapshot>; readonly loads: string[]; readonly stows: string[] }
function resident(host: SimHost): GridResident { return { host, dispose: () => { host.dispose(); } }; }
function stage(): Stage {
  const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cells[0];
  if (cell === undefined) throw new Error('Missing cell');
  const hosts = new Map<string, SimHost>(), saved = new Map<string, SimSnapshot>(), loads: string[] = [], stows: string[] = [];
  const highway = createSimHost(level, { rapier });
  const grid = new GridSimulation(assembly, { highway: resident(highway), save: (id, value) => { saved.set(id, structuredClone(value)); return true; }, read: id => saved.get(id),
    load: (row, snapshot) => { loads.push(row.instance); const host = snapshot === undefined ? createSimHost(level, { rapier }) : restoreSimHost(level, { rapier }, snapshot); hosts.set(row.instance, host); return Promise.resolve(resident(host)); } });
  const loadout = (player: string): GridLoadout => ({ checkpoint: () => true, stow: () => { stows.push(player); }, interior: () => undefined });
  return { grid, room: new GridRoom(grid, assembly, { loadout: player => loadout(player) }), cell, hosts, saved, loads, stows };
}
/** The road east of a cell. Cells sit 562.5 m apart, so 6 m of band either side leaves 6 to 56 m past its edge clear. */
const outside = (cell: GridCell, past: number): GridPoint => ({ x: cell.origin.x + CHUNK_HALF + past, y: 0, z: cell.origin.z });
const walking = (direction: number): SimCommand => ({ moveX: direction, moveZ: 0, yaw: 0 });
const settle = async (): Promise<void> => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); await new Promise(resolve => { setTimeout(resolve, 0); }); };
async function until(stage_: Stage, commands: () => ReadonlyMap<string, SimCommand>, done: () => boolean, ticks = 2400): Promise<void> {
  for (let tick = 0; tick < ticks && !done(); tick++) { stage_.room.step(commands()); await settle(); }
  expect(done()).toBe(true);
}
function place(s: Stage, player: string, at: GridPoint): void {
  const seat = s.grid.host(player).players.get(player); if (seat === undefined) throw new Error('Missing seat');
  seat.position.set(at.x, at.y, at.z); seat.motor.resetAt(seat.position);
}

test('a bot crosses into a cell on its own feet while the lead stays on the road, and each world keeps its clock', async () => {
  const s = stage(), lead = leadPlayer(s.grid.host()).id;
  try {
    place(s, lead, outside(s.cell, 40));
    s.room.join(BOT, outside(s.cell, 8));
    s.room.step();
    await until(s, () => new Map([[BOT, walking(-1)]]), () => s.grid.current(BOT) === s.cell.instance);
    expect(s.grid.current()).toBeNull();
    expect(s.room.drainTravels()).toEqual([{ player: BOT, from: null, to: s.cell.instance }]);
    expect(s.stows).toEqual([]); // nobody stood in a cell yet
    const cell = s.hosts.get(s.cell.instance); if (cell === undefined) throw new Error('Missing cell host');
    // The cell runs for the bot with its lead's seat parked; the road runs for the lead, without the bot.
    expect(cell.parked.has(lead)).toBe(true); expect(s.grid.host().players.has(BOT)).toBe(false);
    const roadTick = s.grid.host().state.tick, cellTick = cell.state.tick;
    const feet = s.grid.worldFeet(BOT);
    for (let tick = 0; tick < 30; tick++) s.room.step(new Map([[BOT, walking(-1)]]));
    expect(cell.state.tick).toBe(cellTick + 30); expect(s.grid.host().state.tick).toBe(roadTick + 30);
    expect(s.grid.worldFeet(BOT).x).toBeLessThan(feet.x - 0.5);
    // The parked seat is out of the world: no input of its own and no capsule in the bot's way.
    expect(cell.players.get(lead)?.motor.snapshot().enabled).toBe(false);
  } finally { s.room.dispose(); s.grid.dispose(); }
});

test('the lead crosses and leaves a bot on the road: the road keeps running and the bot keeps its body', async () => {
  const s = stage(), lead = leadPlayer(s.grid.host()).id, road = s.grid.host();
  try {
    place(s, lead, outside(s.cell, 8));
    s.room.join(BOT, outside(s.cell, 40));
    await until(s, () => new Map([[lead, walking(-1)]]), () => s.grid.current() === s.cell.instance);
    expect(road.parked.has(lead)).toBe(true);
    const tick = road.state.tick, x = road.players.get(BOT)?.position.x ?? 0;
    for (let at = 0; at < 30; at++) s.room.step(new Map([[lead, walking(-1)], [BOT, walking(1)]]));
    expect(road.state.tick).toBe(tick + 30);
    expect(road.players.get(BOT)?.position.x).toBeGreaterThan(x + 0.5);
    expect(s.grid.current(BOT)).toBeNull();
  } finally { s.room.dispose(); s.grid.dispose(); }
});

test('health crosses with each player and a bot leaves no ghost in a cell it left', async () => {
  const s = stage(), lead = leadPlayer(s.grid.host()).id;
  try {
    place(s, lead, outside(s.cell, 30));
    s.room.join(BOT, outside(s.cell, 8));
    const seat = s.grid.host().players.get(BOT); if (seat === undefined) throw new Error('Missing bot');
    seat.health.attributes.health = 40;
    await until(s, () => new Map([[BOT, walking(-1)]]), () => s.grid.current(BOT) === s.cell.instance);
    const cell = s.hosts.get(s.cell.instance); if (cell === undefined) throw new Error('Missing cell host');
    expect(cell.players.get(BOT)?.health.attributes.health).toBe(40);
    await until(s, () => new Map([[BOT, walking(1)]]), () => s.grid.current(BOT) === null);
    expect(s.grid.host(BOT).players.get(BOT)?.health.attributes.health).toBe(40);
    expect(cell.players.has(BOT)).toBe(false);
    expect(cell.parked.size).toBe(0); expect(cell.players.get(lead)?.hasMotor).toBe(false);
    const tick = cell.state.tick;
    for (let at = 0; at < 10; at++) s.room.step();
    expect(cell.state.tick).toBe(tick); // nobody is there: it froze as any neighbour does
    expect(s.stows).toEqual([BOT]);
    expect(s.saved.has(s.cell.instance)).toBe(true);
    // Back from a save that holds the bot's old seat: the cell admits it empty.
    expect(s.grid.unload(s.cell.instance)).toBe(true);
    await until(s, () => new Map([[BOT, walking(-1)]]), () => s.grid.current(BOT) === s.cell.instance);
    expect(s.loads).toEqual([s.cell.instance, s.cell.instance]);
    expect([...(s.hosts.get(s.cell.instance)?.players.keys() ?? [])].sort()).toEqual([BOT, lead].sort());
  } finally { s.room.dispose(); s.grid.dispose(); }
});

test('a lone player crosses exactly as before: nothing parks and the road freezes behind it', async () => {
  const s = stage(), lead = leadPlayer(s.grid.host()).id, road = s.grid.host();
  try {
    place(s, lead, outside(s.cell, 8));
    await until(s, () => new Map([[lead, walking(-1)]]), () => s.grid.current() === s.cell.instance);
    const tick = road.state.tick;
    for (let at = 0; at < 10; at++) s.room.step(new Map([[lead, walking(-1)]]));
    expect(road.state.tick).toBe(tick); expect(road.parked.size).toBe(0); expect(road.players.get(lead)?.hasMotor).toBe(false);
    const inside = s.hosts.get(s.cell.instance)?.players.get(lead)?.position ?? new Vector3();
    expect(Math.abs(inside.x)).toBeLessThan(CHUNK_HALF + 10);
  } finally { s.room.dispose(); s.grid.dispose(); }
});

test('a bot who leaves from a cell lets it freeze', async () => {
  const s = stage(), lead = leadPlayer(s.grid.host()).id;
  try {
    place(s, lead, outside(s.cell, 30));
    s.room.join(BOT, outside(s.cell, 8));
    await until(s, () => new Map([[BOT, walking(-1)]]), () => s.grid.current(BOT) === s.cell.instance);
    const cell = s.hosts.get(s.cell.instance);
    expect(s.room.leave(BOT)).toBe(true); expect(s.room.leave(lead)).toBe(false);
    expect(cell?.parked.size).toBe(0); expect(cell?.players.has(BOT)).toBe(false);
    expect(s.grid.players()).toEqual([lead]);
    s.room.step();
  } finally { s.room.dispose(); s.grid.dispose(); }
});
