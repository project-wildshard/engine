import { afterEach, expect, test, vi } from 'vitest';
import { freshPageArrival, setTitleArrival, consumeTitleArrival } from '../src/client/engine/boot/titleArrival';
import { bootRoute } from '../src/client/app/bootRoute';
import { SaveStore } from '../src/shared/engine/saves/store';
import { gridIntents } from '../src/client/game/grid/intent';
import { travelService, travelSlot } from '../src/client/game/travel/travel';
import { installCatalogueFixture } from './fixtures/bootSetup';

await installCatalogueFixture();

afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); vi.restoreAllMocks(); });

test.each([
  [10_000, 75_000, 10_010, true],
  [10_000, 75_000, 70_000, true],
  [10_000, 75_000, 70_001, false],
  [10_000, 70_000, 0, true],
  [10_000, 70_001, 0, false],
  [80_000, 75_000, 10_010, false],
  [10_000, 75_000, 80_000, false],
  [Number.NaN, 75_000, 10_010, false],
])('arrival %s at clock %s / document %s keeps freshness %s', (at, now, documentAt, expected) => {
  expect(freshPageArrival(at, now, documentAt)).toBe(expected);
});

function handoffs(documentAt: number) {
  vi.stubGlobal('window', {});
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(documentAt);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
  const store = new SaveStore({ local: null, session: null });
  const grid = gridIntents(store);
  const travel = travelService({ source: () => null, slot: travelSlot(store), now: () => Date.now(), navigate: () => undefined });
  grid.set({ instance: 'home', slug: 'driftwood-isle' });
  travel.travel({ to: 'driftwood-isle', mode: 'enter' });
  setTitleArrival({ slug: 'driftwood-isle', mode: 'enter' });
  clock.mockReturnValue(75_000);
  return { grid, travel };
}

test('cold modules retain grid, travel and title entry, and each is consumed once', () => {
  const { grid, travel } = handoffs(10_010);
  expect(grid.consume('driftwood-isle')?.instance).toBe('home');
  expect(travel.consume('driftwood-isle')?.mode).toBe('enter');
  expect(consumeTitleArrival('driftwood-isle')).toEqual({ slug: 'driftwood-isle', mode: 'enter' });
  expect(grid.consume('driftwood-isle')).toBeNull();
  expect(travel.consume('driftwood-isle')).toBeNull();
  expect(consumeTitleArrival('driftwood-isle')).toBeNull();
});

test('early download accounting can inspect a fresh grid tap without spending its one-shot authority', () => {
  const {grid} = handoffs(10_010);
  expect(grid.pending('driftwood-isle')).toBe(true);
  expect(grid.pending('sunscar-dunes')).toBe(false);
  expect(grid.pending('driftwood-isle')).toBe(true);
  expect(grid.consume('driftwood-isle')?.instance).toBe('home');
  expect(grid.pending('driftwood-isle')).toBe(false);
  expect(grid.consume('driftwood-isle')).toBeNull();
});

test('a navigation starting after expiry cannot revive any old handoff', () => {
  const { grid, travel } = handoffs(70_001);
  expect(grid.pending('driftwood-isle')).toBe(false);
  expect(grid.consume('driftwood-isle')).toBeNull();
  expect(travel.consume('driftwood-isle')).toBeNull();
  expect(consumeTitleArrival('driftwood-isle')).toBeNull();
});

test('a different destination refuses and consumes both entry copies', () => {
  const { grid, travel } = handoffs(10_010);
  expect(grid.consume('sunscar-dunes')).toBeNull();
  expect(travel.consume('sunscar-dunes')).toBeNull();
  expect(consumeTitleArrival('sunscar-dunes')).toBeNull();
  expect(grid.consume('driftwood-isle')).toBeNull();
  expect(travel.consume('driftwood-isle')).toBeNull();
  expect(consumeTitleArrival('driftwood-isle')).toBeNull();
});


test.each([
  ['', true],
  ['v=build', true],
  ['tier=phone&touch=1&mute=1&nolock=1&sw=0', true],
  ['tier=phone&touch=1&mute=1&nolock=1&sw=0&v=build', true],
  ['chunk=driftwood-isle&tier=phone&mute=1', false],
  ['chunk=_template&touch=1&sw=0', false],
  ['explore=hub&mute=1', false],
])('environment flags on %s preserve the selected title route %s', (query, titleOnly) => {
  expect(bootRoute(new URLSearchParams(query), { line: '', level: '' })).toEqual({ rescue: false, titleOnly });
});

test('interrupted explicit level entry still returns to the title', () => {
  expect(bootRoute(new URLSearchParams('chunk=driftwood-isle&tier=phone'), { line: 'interrupted', level: 'driftwood-isle' }))
    .toEqual({ rescue: true, titleOnly: true });
});

test('explicit RELOAD returns to title even with a selected shard URL', () => {
  expect(bootRoute(new URLSearchParams('chunk=driftwood-isle'), { line: '', level: '', reload: true }))
    .toEqual({ rescue: true, titleOnly: true });
});
