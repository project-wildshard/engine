import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { ARRIVAL_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { CELLS, EAST, HOME, IDENTITY, WEST, createEntryFixture } from './fixtures/online-zone-entry';

const { entryBench, seated, toGate, close } = createEntryFixture();
afterEach(close);

for (const [to, side, worker] of [[WEST, -1, 'its own worker'], [EAST, 1, 'the other worker']] as const) {
  test(`the page enters ${to} by its gate on ${worker} and the next session is seated past it on the same socket`, { timeout: 180_000 }, async () => {
    const bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
    const page = await seated(), road = bench.road(roadName(HOME));
    await toGate(side, page.steer);
    const enter = page.shell.enter;
    if (enter === undefined) throw new Error('a world page\'s shell says enter');
    const at = await enter(to), inX = -side * (CHUNK_HALF - ARRIVAL_DEPTH);
    expect(at?.x, 'the pose past the gate, in the cell\'s own frame').toBeCloseTo(inX, 5);
    expect(at?.z).toBeCloseTo(0, 5);
    expect(road?.entering(IDENTITY.player), 'frozen at the gate').toBe(to);
    // The old session goes; the client hears nothing of the road it is leaving while the next one loads
    // a phone takes seconds to load the cell: longer than the redial's 3 s with no frame, which must not drop the held link
    await new Promise(resolve => { setTimeout(resolve, 4000); });
    expect(page.shell.client.latest, 'held: the road\'s frames are not the next cell\'s').toBeNull();
    expect(road?.holds(IDENTITY.player), 'still on the road while the page loads').toBe(true);
    // The next session takes the shell over and says ready
    page.shell.rehome?.(to);
    page.shell.ready();
    const target = bench.room(to);
    await vi.waitFor(() => { expect(target?.holds(IDENTITY.player), `seated in ${to}`).toBe(true); }, { timeout: 20_000, interval: 50 });
    await vi.waitFor(() => { expect(page.shell.client.latest?.cell, `frames from ${to}`).toBe(cellFrame(to)); }, { timeout: 10_000, interval: 50 });
    const feet = target?.bodyOf(IDENTITY.player)?.position;
    expect(Math.abs((feet?.x ?? Infinity) - inX), 'past the gate, ARRIVAL_DEPTH in').toBeLessThan(1.5);
    expect(page.shell.client.welcome?.cell, 'welcomed into the cell').toBe(cellFrame(to));
    expect(page.regrids, 'the page never re-enters the grid').toEqual([]);
    expect(page.closes(), 'one socket').toBe(0);
  });
}

test('an enter the road refuses answers null, and the page plays on', { timeout: 120_000 }, async () => {
  const bench = await entryBench({ cells: CELLS, workers: 2, crossing: true });
  const page = await seated();
  const enter = page.shell.enter;
  if (enter === undefined) throw new Error('a world page\'s shell says enter');
  // Standing in Driftwood, never at a gate
  const asked = performance.now();
  expect(await enter(WEST)).toBeNull();
  expect(performance.now() - asked, 'the room refuses before the shell\'s 10 s fallback').toBeLessThan(5000);
  await new Promise(resolve => { setTimeout(resolve, 300); });
  expect(page.shell.client.latest, 'frames still flow').not.toBeNull();
  expect(bench.room(HOME)?.holds(IDENTITY.player)).toBe(true);
  expect(page.closes(), 'one socket').toBe(0);
});
