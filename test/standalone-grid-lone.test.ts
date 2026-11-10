import { expect, test } from 'vitest';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { HOME, PageStorage, ownerX, running, start, until, walk } from './fixtures/standaloneGrid';

// P1-E3.9: a lone cell, one shard on its own page. Split by case from standalone-grid.test.ts (VITEST-BENCH VB5);
// the same server, ports and clock come from ./fixtures/standaloneGrid.

// A one-shard page has one world: its player walks to the shard's own wall and stays there, in that world, on the same frame.
test.each([['a grid shard', HOME], ['a slug the grid does not place', 'pastel-plain']])('a lone cell runs %s inside its own walls', { timeout: 120_000 }, async (_name, slug) => {
  const storage = new PageStorage(), { shell, stop } = start(storage, undefined, slug, true), travels: NetTravel[] = [];
  shell.client.onTravel(event => { travels.push(event); });
  await shell.booted;
  const seat = running()?.host.players.get('actor.player');
  if (seat === undefined) throw new Error('No session player');
  seat.position.set(-230, seat.position.y + 60, seat.position.z); seat.motor.resetAt(seat.position); // a minute's walk from spawn
  shell.ready();
  await until(() => shell.client.latest !== null);
  const frame = shell.client.latest?.cell;
  expect(frame).toBe(1);
  let last = ownerX(shell), still = 0;
  await walk(shell, Math.PI / 2, () => { const at = ownerX(shell); still = Math.abs(at - last) < 0.01 ? still + 1 : 0; last = at; return still > 400; });
  expect(last).toBeGreaterThan(-250);
  expect(travels).toEqual([]);
  expect(shell.client.latest?.cell).toBe(frame);
  expect((await shell.save()).ok).toBe(true);
  expect(storage.getItem(`wildshard.standalone-lone-${slug}`)?.length).toBeGreaterThan(1000);
  stop();
});

test('a player who falls out of a world is the server\'s to put back', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), { shell, stop } = start(storage, undefined, 'pastel-plain', true);
  await shell.booted;
  shell.ready();
  await until(() => shell.client.latest !== null);
  const seat = running()?.host.players.get('actor.player'), host = running()?.host;
  if (seat === undefined || host === undefined) throw new Error('No session player');
  seat.position.set(0, -251, 0); seat.motor.resetAt(seat.position);
  // one shard, one world: a fall is no death here, it goes back to where the player last stood
  await walk(shell, 0, () => seat.position.y > -250);
  expect(host.respawn.falls(seat.id)).toBe(0);
  stop();
});
