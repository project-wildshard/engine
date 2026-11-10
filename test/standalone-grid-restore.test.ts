import { expect, test } from 'vitest';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { assembly, cell, ownerX, PageStorage, running, start, until, walk } from './fixtures/standaloneGrid';

// P1-E3.9, E5.2b: a reload resumes a world, on Nine Dragon's deck and with J68's far solids. Split by case from
// standalone-grid.test.ts (VITEST-BENCH VB5); the same server, ports and clock come from ./fixtures/standaloneGrid.

// Nine has no terrain: its deck has to meet the road's, and only the plan's server files stand behind it.
test('a client walks off the road onto Nine Dragon\'s deck, and a reload resumes it there', { timeout: 120_000 }, async () => {
  const nine = assembly.cells.find(row => row.slug === 'nine-dragon-stack');
  if (nine === undefined) throw new Error('The grid places no Nine Dragon');
  const storage = new PageStorage(), first = start(storage, { x: nine.origin.x - 259, y: 0, z: nine.origin.z }), travels: NetTravel[] = [], { client } = first.shell;
  client.onTravel(event => { travels.push(event); });
  await first.shell.booted; first.shell.ready();
  await until(() => client.latest !== null);
  await walk(first.shell, -Math.PI / 2, () => travels.length === 1);
  expect(travels[0]).toMatchObject({ from: 0, to: cell('nine-dragon-stack') });
  await walk(first.shell, -Math.PI / 2, () => client.latest?.cell === cell('nine-dragon-stack') && ownerX(first.shell) > -245);
  expect(client.dropped).toBe(0);
  const inside = await first.shell.save(), stood = ownerX(first.shell);
  expect(inside.ok).toBe(true);
  first.stop();
  const second = start(storage);
  expect(await second.shell.booted).toEqual({ tick: inside.tick, restored: true });
  second.shell.ready();
  await until(() => second.shell.client.latest !== null);
  expect(second.shell.client.latest?.cell).toBe(cell('nine-dragon-stack'));
  expect(Math.abs(ownerX(second.shell) - stood)).toBeLessThan(2);
  second.stop();
});

test('J68: a world keeps its far solids as data, in its save too, and a restored one knows them again', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), first = start(storage, undefined, 'nalati-grasslands');
  await first.shell.booted; first.shell.ready();
  await until(() => (running()?.near.live ?? 0) > 0 || first.shell.client.latest !== null);
  const held = running()?.near.held ?? 0;
  expect(held).toBeGreaterThan(1000);
  await until(() => (first.shell.client.latest?.tick ?? 0) > 10);
  expect(running()?.near.live).toBeLessThan(held / 4);
  expect((await first.shell.save()).ok).toBe(true);
  expect(storage.getItem('wildshard.standalone-nalati-grasslands')?.length).toBeLessThan(2_000_000);
  first.stop();
  const second = start(storage, undefined, 'nalati-grasslands');
  expect((await second.shell.booted).restored).toBe(true);
  expect(running()?.near.held).toBe(held);
  second.stop();
});
