import { expect, test } from 'vitest';
import { ArenaRoomGround, sandWireName } from '../src/shared/game/boss/arenaGround';

const rows = { origin: { x: 0, y: 0, z: 0 }, halfWidth: 10, corridorHalfWidth: 2, corridorEnd: 20, cover: { x: 0, z: 0, wid: 1, len: 1, plinthH: 0.2, h: 1 }, pedestal: { x: 5, z: 5 }, beams: [], sandCells: 40 };
const room = (): ArenaRoomGround => new ArenaRoomGround(rows);

test('a calm room sends no rows, and a page reads a drift to within a byte', () => {
  const server = room(), page = room(), name = sandWireName('room');
  expect(server.sandRows(name)).toEqual([]);
  server.addSand(1, 2, 3, 0.6);
  server.addSand(-4, 3, 1.5, 0.4);
  const wire = server.sandRows(name), held = new Map(wire.map(row => [row.name, row.value]));
  expect(wire.length).toBeGreaterThan(0);
  expect(wire.length).toBeLessThan(134); // a strip with no sand sends nothing
  page.mirrorSand(strip => held.get(`${name}.${String(strip)}`));
  for (let cell = 0; cell < server.sand.length; cell++) expect(Math.abs((page.sand[cell] ?? 0) - (server.sand[cell] ?? 0))).toBeLessThan(0.003);
  expect(page.sandPeak).toBeCloseTo(server.sandPeak, 2);
  expect(page.pace(1)).toBe(true); // a change is due a write, as a fight's would be
  server.clearSand();
  expect(server.sandRows(name)).toEqual([]);
  page.mirrorSand(() => undefined);
  expect(page.sandPeak).toBe(0);
});
test('a row is whole in an f32', () => {
  const server = room();
  server.addSand(0, 0, 9, 1);
  for (const { value } of server.sandRows('s')) { expect(Math.fround(value)).toBe(value); expect(value).toBeLessThanOrEqual(0xffffff); }
});
