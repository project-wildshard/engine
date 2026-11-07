// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NetClient } from '../src/client/engine/net/client';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost, type SimLevel } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import type { SimSnapshot } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { directLoopback } from '../src/test/engine/netLoopback';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { GridRoom } from '../src/server/game/grid/room';
import { GridNetRooms } from '../src/server/game/grid/roomNet';
import { GridSimulation } from '../src/server/game/grid/simulation';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3.9: a client over the real codec walks its player out of the road and into a cell. It hears `travel`, its frames name
// the new cell, its positions turn cell-local, and it keeps steering with the same command stream.
const BOT = 'bot:1', level: SimLevel = { ...SIM_LEVEL, entities: [], ground: { size: 3000, height: 0 } };
const settle = async (): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, 0); }); };

test('a client crosses with its player: travel, a new welcome, cell-local frames, the same commands', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cells[0];
  if (cell === undefined) throw new Error('Missing cell');
  const highway = createSimHost(level, { rapier }), hosts = new Map<string, SimHost>(), saved = new Map<string, SimSnapshot>();
  const grid = new GridSimulation(assembly, { highway: { host: highway, dispose: () => { highway.dispose(); } }, save: (id, value) => { saved.set(id, value); return true; },
    load: (_row, snapshot) => {
      const host = snapshot === undefined ? createSimHost(level, { rapier }) : restoreSimHost(level, { rapier }, snapshot); hosts.set(cell.instance, host);
      return Promise.resolve({ host, dispose: () => { host.dispose(); } });
    } });
  const room = new GridRoom(grid, assembly, { loadout: () => ({ checkpoint: () => true, stow: () => undefined, interior: () => undefined }) }), rooms = new GridNetRooms(grid, room, assembly);
  const link = directLoopback(), client = new NetClient(link.client), travels: NetTravel[] = [];
  try {
    const lead = leadPlayer(highway), { x, z } = cell.origin;
    lead.position.set(x + CHUNK_HALF + 30, 0, z); lead.motor.resetAt(lead.position);
    room.join(BOT, { x: x + CHUNK_HALF + 8, y: 0, z });
    rooms.connect(BOT, link.server); client.hello(); link.pump();
    client.onTravel(event => { travels.push(event); });
    expect(client.welcome?.cell).toBe(0);
    const tick = (): void => { client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: 0 }); client.flush(); link.pump(); rooms.tick(); link.pump(); };
    tick(); tick(); // frames go out every second tick
    const road = client.latest; if (road === null) throw new Error('Missing first frame');
    expect(road.cell).toBe(0); expect(Number(client.owner(road)['px'])).toBeGreaterThan(CHUNK_HALF);
    const seen = [...client.entities.values()].map(entity => entity.id);
    expect(seen).toContain(lead.id);
    for (let at = 0; at < 1200 && travels.length === 0; at++) { tick(); await settle(); }
    expect(travels).toHaveLength(1);
    expect(travels[0]).toMatchObject({ from: 0, to: assembly.cells.indexOf(cell) + 1 });
    tick(); tick(); tick();
    const inside = client.latest; if (inside === null) throw new Error('Missing frame after crossing');
    const seat = hosts.get(cell.instance)?.players.get(BOT); if (seat === undefined) throw new Error('Missing bot seat');
    expect(inside.cell).toBe(travels[0]?.to); expect(client.welcome?.cell).toBe(travels[0]?.to);
    expect(inside.baselineTick === 0xffffffff || inside.tick > 0).toBe(true);
    // Cell-local now: the owner block matches the seat, not the world coordinate the road used.
    expect(Math.abs(Number(client.owner(inside)['px']) - seat.position.x)).toBeLessThan(0.2);
    expect(Math.abs(Number(client.owner(inside)['px']))).toBeLessThan(CHUNK_HALF + 10);
    // The road's world is gone from this client, and the cell's parked lead was never in it.
    expect([...client.entities.values()].map(entity => entity.id)).not.toContain(lead.id);
    // Still steering, by the same stream: `lastSeq` runs on past the crossing and the seat keeps moving.
    const lastSeq = inside.lastSeq, before = seat.position.x;
    for (let at = 0; at < 20; at++) tick();
    expect(client.latest?.lastSeq).toBeGreaterThan(lastSeq); expect(seat.position.x).toBeLessThan(before - 0.2);
    expect(client.dropped).toBe(0);
  } finally { client.dispose(); rooms.dispose(); room.dispose(); grid.dispose(); }
});

// A player's feet can cross with nobody holding them: their client left, or never said hello. Neither room may mind.
test.each([['left', true], ['never said hello', false]])('a player crosses after their client %s, and the rooms go on', async (_name, left) => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cells[0];
  if (cell === undefined) throw new Error('Missing cell');
  const highway = createSimHost(level, { rapier }), hosts = new Map<string, SimHost>();
  const grid = new GridSimulation(assembly, { highway: { host: highway, dispose: () => { highway.dispose(); } }, save: () => true,
    load: () => { const host = createSimHost(level, { rapier }); hosts.set(cell.instance, host); return Promise.resolve({ host, dispose: () => { host.dispose(); } }); } });
  const room = new GridRoom(grid, assembly, { loadout: () => ({ checkpoint: () => true, stow: () => undefined, interior: () => undefined }) }), rooms = new GridNetRooms(grid, room, assembly);
  const link = directLoopback(), client = new NetClient(link.client), { x, z } = cell.origin;
  try {
    const lead = leadPlayer(highway);
    lead.position.set(x + CHUNK_HALF + 30, 0, z); lead.motor.resetAt(lead.position);
    room.join(BOT, { x: x + CHUNK_HALF + 8, y: 0, z });
    rooms.connect(BOT, link.server);
    if (left) { client.hello(); link.pump(); link.client.close(); }
    const seat = highway.players.get(BOT); if (seat === undefined) throw new Error('Missing bot seat');
    seat.position.set(x, 0, z); seat.motor.resetAt(seat.position);
    for (let at = 0; at < 600 && hosts.get(cell.instance)?.players.has(BOT) !== true; at++) { rooms.tick(); link.pump(); await settle(); }
    expect(hosts.get(cell.instance)?.players.has(BOT)).toBe(true);
    const tick = hosts.get(cell.instance)?.state.tick ?? 0;
    for (let at = 0; at < 4; at++) rooms.tick();
    expect(hosts.get(cell.instance)?.state.tick).toBeGreaterThan(tick);
    if (!left) expect(client.closed, 'it has no room to say hello to now').toBe('refused');
  } finally { client.dispose(); rooms.dispose(); room.dispose(); grid.dispose(); }
});
