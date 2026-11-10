import { expect, test } from 'vitest';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { cell, NEIGHBOUR, ownerX, PageStorage, start, until, walk } from './fixtures/standaloneGrid';

// P1-E3.9, E5.2b: the grid in the server's half, over real MessagePorts on the server's own clock. A client walks off the road
// into a cell and back, hearing `travel` both ways, and a reload resumes it wherever it stood. Only a server's bytes are read.
// Split by case (VITEST-BENCH VB5): the lone-cell cases are in standalone-grid-lone.test.ts, Nine Dragon's deck and J68's far
// solids in standalone-grid-restore.test.ts; all three share ./fixtures/standaloneGrid.

test('a client walks off the road into a cell and back, and a reload resumes it wherever it stood', { timeout: 120_000 }, async () => {
  const storage = new PageStorage(), first = start(storage, { x: -259, y: 0, z: 0 }), travels: NetTravel[] = [], { client } = first.shell;
  client.onTravel(event => { travels.push(event); });
  expect(await first.shell.booted).toEqual({ tick: 0, restored: false });
  first.shell.ready();
  await until(() => client.latest !== null);
  expect(client.latest?.cell).toBe(0);
  await walk(first.shell, -Math.PI / 2, () => travels.length === 1);
  expect(travels[0]).toMatchObject({ from: 0, to: cell(NEIGHBOUR) });
  // cell-local now: the deck runs up to the edge of Driftwood's own world, and its colliders take over from there
  await walk(first.shell, -Math.PI / 2, () => client.latest?.cell === cell(NEIGHBOUR) && ownerX(first.shell) > -245);
  expect(client.dropped).toBe(0);
  const inside = await first.shell.save(); expect(inside.ok).toBe(true);
  const stood = ownerX(first.shell);
  first.stop();
  expect(storage.getItem(`wildshard.standalone-${NEIGHBOUR}`)?.length).toBeGreaterThan(1000);

  const second = start(storage), back: NetTravel[] = [];
  second.shell.client.onTravel(event => { back.push(event); });
  expect(await second.shell.booted).toEqual({ tick: inside.tick, restored: true });
  second.shell.ready();
  await until(() => second.shell.client.latest !== null);
  expect(second.shell.client.latest?.cell).toBe(cell(NEIGHBOUR));
  expect(Math.abs(ownerX(second.shell) - stood)).toBeLessThan(2);
  await walk(second.shell, Math.PI / 2, () => back.length === 1);
  expect(back[0]).toMatchObject({ from: cell(NEIGHBOUR), to: 0 });
  await until(() => second.shell.client.latest?.cell === 0);
  expect(ownerX(second.shell)).toBeLessThan(-250); // world coordinates again
  const road = await second.shell.save(); expect(road.ok).toBe(true);
  second.stop();

  const third = start(storage);
  expect(await third.shell.booted).toEqual({ tick: road.tick, restored: true });
  third.shell.ready();
  await until(() => third.shell.client.latest !== null);
  expect(third.shell.client.latest?.cell).toBe(0);
  third.stop();
});
