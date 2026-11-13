import { expect, test } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { PageStorage, assembly, cell, running, start, until, walk } from './fixtures/standaloneGrid';

// GRID-CROSSING GC30b (QA-FEEDBACK-2026-11-13 row 11; J322, Jake 11-13: "There should never be any walls"): preview's in-page road
// let Jake walk into Far Reach at y 0 with nothing under him, and he fell. Far Reach's entryways have no ground of their own (its sky
// islands), so a walker who crosses in is set down on the first ground they can stand on, the cell's spawn, never left in the air.

test('a walker off the road into Far Reach lands on ground and stays standing', { timeout: 120_000 }, async () => {
  const far = assembly.cell('far-reach'), edge = far.origin.z + CHUNK_HALF;
  const storage = new PageStorage(), { shell, stop } = start(storage, { x: far.origin.x, y: 0, z: edge + 9 }), travels: NetTravel[] = [];
  shell.client.onTravel(event => { travels.push(event); });
  await shell.booted;
  shell.ready();
  await until(() => shell.client.latest !== null);
  expect(shell.client.latest?.cell).toBe(0);
  await walk(shell, 0, () => travels.length === 1); // yaw 0 is -z: off the road, into Far Reach
  expect(travels[0]).toMatchObject({ from: 0, to: cell('far-reach') });
  const host = running()?.host, seat = host?.players.get('actor.player');
  if (host === undefined || seat === undefined) throw new Error('No session player');
  const spawn = host.level.player.at;
  let lowest = Number.POSITIVE_INFINITY;
  // two seconds of standing still: a body with nothing under it would be metres down by now
  for (let tick = 0; tick < 40; tick++) { lowest = Math.min(lowest, seat.position.y); await new Promise(done => { setTimeout(done, 50); }); }
  expect(lowest).toBeGreaterThan(spawn.y - 2);
  expect(Math.hypot(seat.position.x - spawn.x, seat.position.z - spawn.z)).toBeLessThan(4);
  expect(host.respawn.falls(seat.id)).toBe(0);
  stop();
});
