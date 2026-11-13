import { expect, test } from 'vitest';
import { GridCrossing, type GridCrossingPorts, type PreparedGridCrossing } from '../src/shared/game/grid/crossing';

// GRID-CROSSING GC32 (GC15c item 2): turning back from a crossing the target refuses frees the player. Far Reach refuses (no
// entryway ground, GC30; or a cell on another worker), so the crossing toward it is blocked; the player turns round and the
// crossing must settle back home (in the cell) or cross back in (from the road), never stay blocked on the refused cell.
// The server half is `dedicated-road-no-ground.test.ts` (the seat held on the road walks back into Driftwood); the page half on
// staging is `grid-crossing-walk-proof.mjs --to=farreach|nalati` (boost back reaches control in Driftwood, Chromium and WebKit).
const HOME = 'driftwood-isle', REFUSED = 'far-reach';

function harness(current: string | null) {
  const changed: [string | null, string | null][] = [], interiors: string[] = [], stows: string[] = [];
  let prepares = 0;
  const ports: GridCrossingPorts = {
    prepare: (_from, to) => {
      prepares++;
      if (to === REFUSED) return Promise.reject(new Error(`${REFUSED} has no ground at its entryway`));
      const prepared: PreparedGridCrossing = { commit: () => undefined, cancel: () => undefined };
      return Promise.resolve(prepared);
    },
    ready: () => true, checkpoint: () => true,
    stow: instance => { stows.push(instance); }, interior: instance => { interiors.push(instance); },
    changed: (from, to) => { changed.push([from, to]); },
  };
  return { crossing: new GridCrossing(current, ports), changed, interiors, stows, prepares: () => prepares };
}
const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });

test('on the road, a refused cell blocks the crossing, and walking back crosses home', async () => {
  const { crossing, changed } = harness(null);
  crossing.request(REFUSED);
  await settle();
  expect(crossing.state()).toMatchObject({ current: null, target: REFUSED, phase: 'blocked' });
  expect(crossing.step(false), 'a blocked crossing never commits').toBe(false);
  expect(crossing.state().current, 'still on the road').toBeNull();
  // the player turns round: the feet head back into Driftwood's mouth
  crossing.request(HOME);
  expect(crossing.state()).toMatchObject({ target: HOME, phase: 'preparing', issue: null });
  await settle();
  expect(crossing.state().phase).toBe('ready');
  expect(crossing.step(true), 'the walk back commits').toBe(true);
  expect(crossing.state()).toMatchObject({ current: HOME, target: HOME, phase: 'settled', issue: null });
  expect(changed).toEqual([[null, HOME]]);
});

test('inside the cell, heading at a refused neighbour and turning back settles home at once, with nothing committed', async () => {
  const { crossing, changed, interiors, prepares } = harness(HOME);
  crossing.step(true);
  crossing.request(REFUSED);
  await settle();
  expect(crossing.state()).toMatchObject({ current: HOME, phase: 'blocked' });
  crossing.step(true);
  const asked = prepares();
  crossing.request(HOME);
  expect(crossing.state(), 'settled without a preparation').toMatchObject({ current: HOME, target: HOME, phase: 'settled', issue: null });
  expect(prepares()).toBe(asked);
  expect(crossing.step(true), 'nothing to commit').toBe(false);
  expect(changed).toEqual([]);
  expect(interiors.at(-1), 'the home interior is active again').toBe(HOME);
});

test('a blocked crossing asked again retries its preparation (the target may be ready now)', async () => {
  const { crossing, prepares } = harness(null);
  crossing.request(REFUSED);
  await settle();
  const asked = prepares();
  crossing.request(REFUSED);
  expect(prepares()).toBe(asked + 1);
});
