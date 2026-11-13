import { expect, test } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { HOME, PageStorage, running, start, until, walk } from './fixtures/standaloneGrid';

// P1-E3.9: a lone cell, one shard on its own page. Split by case from standalone-grid.test.ts (VITEST-BENCH VB5);
// the same server, ports and clock come from ./fixtures/standaloneGrid.

// GRID-CROSSING GC36 (J322, Jake 11-13: "There should never be any walls [...] no way back is better than the wall"): a one-shard page
// has one world and no walls. Its player walks off the shard's edge, falls, and the server puts them back on the ground they last
// stood on, in that world, on the same frame.
test.each([['a grid shard', HOME], ['a slug the grid does not place', 'pastel-plain']])('a lone cell runs %s with no wall at its edge', { timeout: 120_000 }, async (_name, slug) => {
  const storage = new PageStorage(), { shell, stop } = start(storage, undefined, slug, true), travels: NetTravel[] = [];
  shell.client.onTravel(event => { travels.push(event); });
  await shell.booted;
  const seat = running()?.host.players.get('actor.player'), host = running()?.host;
  if (seat === undefined || host === undefined) throw new Error('No session player');
  seat.position.set(-230, seat.position.y + 60, seat.position.z); seat.motor.resetAt(seat.position); // a minute's walk from spawn
  shell.ready();
  await until(() => shell.client.latest !== null);
  const frame = shell.client.latest?.cell;
  expect(frame).toBe(1);
  // Walk out (-x) until the body is past the edge, where a wall used to stand at -249.2.
  let past = Infinity;
  await walk(shell, Math.PI / 2, () => { past = Math.min(past, seat.position.x); return past < -CHUNK_HALF - 1; });
  expect(past, 'walked past the shard\'s edge').toBeLessThan(-CHUNK_HALF);
  // Off the edge there is nothing to stand on: the body falls, and the fall floor sets it back on the last ground it stood on (the
  // edge's lip, within a capsule of 250), standing, not a death.
  let fell = false;
  await until(() => { fell ||= seat.position.y < -5; return fell && seat.fall.grounded && seat.position.y > -2; }, 60_000);
  expect(seat.position.x).toBeGreaterThan(-CHUNK_HALF - 1);
  expect(host.respawn.falls(seat.id)).toBe(0);
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
