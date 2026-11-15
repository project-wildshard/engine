// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimCommand, type SimHost, type SimLevel } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHost, type SimSnapshot } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { GridAssembly, type GridCell, type GridPoint } from '../src/shared/game/grid/assembly';
import { GridRoom } from '../src/server/game/grid/room';
import { GridSimulation, type GridResident } from '../src/server/game/grid/simulation';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// ZONE-ENTRY ZE2: the in-page server's step out of a cell stood its tick for a whole world's capture (122 to 134 ms on
// Driftwood), and the page's walk stood with it. The world left stays resident, so the capture waits for its eviction.
const level: SimLevel = { ...SIM_LEVEL, entities: [], ground: { size: 3000, height: 0 } };
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

const resident = (host: SimHost): GridResident => ({ host, dispose: () => { host.dispose(); } });
const outside = (cell: GridCell, past: number): GridPoint => ({ x: cell.origin.x + CHUNK_HALF + past, y: 0, z: cell.origin.z });
const walking = (direction: number): SimCommand => ({ moveX: direction, moveZ: 0, yaw: 0 });
const settle = async (): Promise<void> => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); await new Promise(resolve => { setTimeout(resolve, 0); }); };

test('leaving a cell for the road captures nothing; its eviction takes the capture, and the world comes back as it was left', async () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), [home, other] = assembly.cells;
  if (home === undefined || other === undefined) throw new Error('Missing cells');
  const captures: string[] = [], saved = new Map<string, SimSnapshot>(), hosts = new Map<string, SimHost>();
  const highway = createSimHost(level, { rapier });
  const grid = new GridSimulation(assembly, { highway: resident(highway), maxResidents: 1, read: id => saved.get(id),
    durable: (id, host) => { captures.push(id); saved.set(id, structuredClone(snapshotSimHost(host))); return true; },
    load: (row, snapshot) => { const host = snapshot === undefined ? createSimHost(level, { rapier }) : restoreSimHost(level, { rapier }, snapshot); hosts.set(row.instance, host); return Promise.resolve(resident(host)); } });
  const room = new GridRoom(grid, assembly, { loadout: () => ({ checkpoint: () => true, stow: () => undefined, interior: () => undefined }) });
  const until = async (command: SimCommand, done: () => boolean): Promise<void> => {
    for (let tick = 0; tick < 2400 && !done(); tick++) { room.step(new Map([[leadPlayer(grid.host()).id, command]])); await settle(); }
    expect(done()).toBe(true);
  };
  try {
    const seat = grid.host().players.get(leadPlayer(grid.host()).id);
    seat?.position.set(outside(home, 8).x, 0, outside(home, 8).z); seat?.motor.resetAt(seat.position);
    await until(walking(-1), () => grid.current() === home.instance);
    hosts.get(home.instance)?.flags.set('ze2.left-behind');
    await until(walking(1), () => grid.current() === null);
    expect(captures).toEqual([]); // red before ZE2: the leave captured the whole world on the step
    expect(grid.ready(home.instance)).toBe(true);
    await grid.prefetch([other.instance]); // one resident: the home is evicted, and only now captured
    expect(captures).toEqual([home.instance]);
    expect(grid.ready(home.instance)).toBe(false);
    await grid.prefetch([home.instance]);
    expect(hosts.get(home.instance)?.flags.has('ze2.left-behind')).toBe(true);
    await until(walking(-1), () => grid.current() === home.instance); // the restored world takes its owner back
  } finally { room.dispose(); grid.dispose(); }
});

// review of plan/gcm7: a save on the road wrote only the road, so a reload there (every zone entry reloads the page) lost the home's
// state since its last in-cell save. A save first takes every capture still owed.
test('a save on the road takes the capture the step out left owed', async () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), [home] = assembly.cells;
  if (home === undefined) throw new Error('Missing cells');
  const captures: string[] = [], hosts = new Map<string, SimHost>();
  const highway = createSimHost(level, { rapier });
  const grid = new GridSimulation(assembly, { highway: resident(highway), maxResidents: 1, read: () => undefined,
    durable: (id) => { captures.push(id); return true; },
    load: row => { const host = createSimHost(level, { rapier }); hosts.set(row.instance, host); return Promise.resolve(resident(host)); } });
  const room = new GridRoom(grid, assembly, { loadout: () => ({ checkpoint: () => true, stow: () => undefined, interior: () => undefined }) });
  const until = async (command: SimCommand, done: () => boolean): Promise<void> => {
    for (let tick = 0; tick < 2400 && !done(); tick++) { room.step(new Map([[leadPlayer(grid.host()).id, command]])); await settle(); }
    expect(done()).toBe(true);
  };
  try {
    const seat = grid.host().players.get(leadPlayer(grid.host()).id);
    seat?.position.set(outside(home, 8).x, 0, outside(home, 8).z); seat?.motor.resetAt(seat.position);
    await until(walking(-1), () => grid.current() === home.instance);
    await until(walking(1), () => grid.current() === null);
    expect(captures).toEqual([]);
    expect(grid.flushOwed()).toBe(true);
    expect(captures).toEqual([home.instance]);
    expect(grid.flushOwed()).toBe(true);
    expect(captures).toEqual([home.instance]); // taken once
    expect(grid.ready(home.instance)).toBe(true); // and still resident
  } finally { room.dispose(); grid.dispose(); }
});
