import { expect, test } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { PageStorage, assembly, cell, running, start, until, walk } from './fixtures/standaloneGrid';

// GRID-CROSSING GC30b (QA-FEEDBACK-2026-11-13 row 11; J322, Jake 11-13: "There should never be any walls"): preview's in-page road
// let Jake walk into Far Reach at y 0 with nothing under him, and he fell. Sky Reach rev 3 (cdbb400c) gives each of Far Reach's
// entryways a dock at road height, so a walker who crosses in stands on the north dock, never in the air. A cell with no entryway
// ground at all would still set them down on its spawn (GridSimulation's landOnGround).

test('a walker off the road into Far Reach stands on its north dock', { timeout: 120_000 }, async () => {
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
  let lowest = Number.POSITIVE_INFINITY;
  // two seconds of standing still: a body with nothing under it would be metres down by now
  for (let tick = 0; tick < 40; tick++) { lowest = Math.min(lowest, seat.position.y); await new Promise(done => { setTimeout(done, 50); }); }
  expect(lowest).toBeGreaterThan(-0.5);
  // on the north dock (the cell's own frame), not moved to the spawn island
  expect(seat.position.z).toBeGreaterThan(CHUNK_HALF - 15);
  expect(Math.abs(seat.position.x)).toBeLessThan(4);
  expect(host.respawn.falls(seat.id)).toBe(0);
  stop();
});
