import { expect, test } from 'vitest';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { NEIGHBOUR, PageStorage, cell, running, start, until, walk } from './fixtures/standaloneGrid';

// GRID-CROSSING GC34 / ROAD-PRELOAD RP4 (Jake 11-13: "I just want to be able to instantaneously go onto the road"): a crossing hands
// the walker to the destination world's seat. That seat started from rest, so a walk across the line stopped for ~0.3 s while the
// page's prediction caught the server's standing body (RP1: a 311 ms stop at x -260). The walker keeps their speed across it.
test('a walker keeps their speed across a crossing from the road into a cell', { timeout: 120_000 }, async () => {
  const storage = new PageStorage(), { shell, stop } = start(storage, { x: -275, y: 0, z: 0 }), travels: NetTravel[] = [];
  shell.client.onTravel(event => { travels.push(event); });
  await shell.booted;
  shell.ready();
  await until(() => shell.client.latest !== null);
  const speeds: { site: string | null; speed: number }[] = [];
  const sample = setInterval(() => {
    const grid = running()?.grid, seat = grid?.host().players.get('actor.player');
    if (grid !== undefined && seat !== undefined) speeds.push({ site: grid.current(), speed: Math.hypot(seat.velocity.x, seat.velocity.z) });
  }, 1);
  // Keep walking past the travel event until the cell side has been sampled: the server switches the site and sends `travel` in
  // one tick, so stopping at the event left at most one sample past the line, and none on a slow CI runner (expected -1 > 0).
  const past = (): number => speeds.filter(row => row.site !== null).length;
  try { await walk(shell, -Math.PI / 2, () => travels.length === 1 && past() >= 20); } finally { clearInterval(sample); }
  expect(travels[0]).toMatchObject({ from: 0, to: cell(NEIGHBOUR) });
  const first = speeds.findIndex(row => row.site !== null);
  expect(first, 'sampled both sides of the crossing').toBeGreaterThan(0);
  const before = speeds.slice(0, first).filter(row => row.site === null).at(-1)?.speed ?? 0;
  const after = speeds.slice(first).map(row => row.speed);
  expect(before, 'walking on the road').toBeGreaterThan(2);
  expect(Math.min(...after), 'still walking just past the crossing').toBeGreaterThan(before * 0.8);
  stop();
});
