import { afterEach, expect, test, vi } from 'vitest';
import { freshPageArrival, setTitleArrival, consumeTitleArrival, dropTabArrival, pendingTitleArrival, tapNavigatedHere } from '../src/client/engine/boot/titleArrival';
import { saveStorage } from '../src/client/engine/saves/slots';
import { exploreSlugOfPath } from '../src/client/app/slugPath';
import { adoptSlugAliases } from '../src/shared/game/slugNames';

// OF31i4: the retired slug is world data; the placement file lays it in (as the box and page do)
adoptSlugAliases({ 'blender-template': 'brasscap-mesa' });
import { bootRoute, exploreBootParams, onlineTitleFirst } from '../src/client/app/bootRoute';
import { SaveStore } from '../src/shared/engine/saves/store';
import { gridIntents } from '../src/client/game/grid/intent';
import { travelAddress, travelService, travelSlot } from '../src/client/game/travel/travel';
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
  // TEMPLATE-E2E TR-4: T1's seat (`mute=1&nolock=1&sw=0&fps=30`) is the title: a frame cap selects no level, so its first Play is a tap
  // like the one after Exit to Title (which drops the flags), and both enter the same world and save.
  ['mute=1&nolock=1&sw=0&fps=30', true],
  ['chunk=driftwood-isle&tier=phone&mute=1', false],
  ['chunk=brasscap-mesa&touch=1&sw=0', false],
  ['explore=hub&mute=1', false],
])('environment flags on %s preserve the selected title route %s', (query, titleOnly) => {
  expect(bootRoute(new URLSearchParams(query), { line: '', level: '' })).toEqual({ rescue: false, titleOnly });
});

test('interrupted explicit level entry still returns to the title', () => {
  expect(bootRoute(new URLSearchParams('chunk=driftwood-isle&tier=phone'), { line: 'interrupted', level: 'driftwood-isle' }))
    .toEqual({ rescue: true, titleOnly: true });
});

test('CP4: the WebKit rescue compares the zone this load boots (the tap the boot adopted), not the address', () => {
  const booting = new URLSearchParams('mute=1'); booting.set('chunk', 'pine-hollow'); // entry.ts adoptTap on a bare address
  expect(bootRoute(booting, { line: 'interrupted', level: 'pine-hollow' })).toEqual({ rescue: true, titleOnly: true });
  expect(bootRoute(booting, { line: 'interrupted', level: 'glowfen' }).rescue, 'another zone than the one that died').toBe(false);
});

test('explicit RELOAD returns to title even with a selected shard URL', () => {
  expect(bootRoute(new URLSearchParams('chunk=driftwood-isle'), { line: '', level: '', reload: true }))
    .toEqual({ rescue: true, titleOnly: true });
});

test('an online build enters a level only from a tap (QA row 16)', () => {
  const at = (query: string): URLSearchParams => new URLSearchParams(query);
  expect(onlineTitleFirst(at('chunk=driftwood-isle'), true, false), 'a reopened tab or bookmark lands on the title').toBe(true);
  expect(onlineTitleFirst(at('chunk=driftwood-isle'), true, true), 'a title tap or grid intent enters').toBe(false);
  expect(onlineTitleFirst(at('chunk=driftwood-isle&skipintro=1'), true, false), 'a harness that skips the title enters').toBe(false);
  expect(onlineTitleFirst(at('chunk=driftwood-isle&tour=1'), true, false)).toBe(false);
  // QA-FEEDBACK-2026-11-13 rows 6 and 13 (WILDSHARD-GAME-8H): the engine's own reload (GPU recovery, RELOAD HERE, the reload
  // prompt) carries ?glreload and returns to the world, not the title; play.ts strips it once read, so a reopened tab has none
  expect(onlineTitleFirst(at('chunk=driftwood-isle&glreload=1&at=1,2,3,0,0'), true, false), 'GPU recovery returns to the world').toBe(false);
  expect(onlineTitleFirst(at('glreload=1'), true, false), 'a grid page recovery reload too').toBe(false);
  expect(onlineTitleFirst(at('chunk=driftwood-isle'), false, false), 'the solo build keeps its deep links').toBe(false);
  expect(onlineTitleFirst(at(''), true, false), 'the plain title is the title already').toBe(false);
  expect(onlineTitleFirst(at('utm_source=bookmark'), true, false), 'a setting that boots the default level is no tap either').toBe(true);
  expect(onlineTitleFirst(at('explore=hub'), true, false)).toBe(true);
  expect(onlineTitleFirst(at('mute=1&v=2'), true, false), 'harness settings alone are the title already').toBe(false);
});

test('a page reloading itself hands the tap to its own tab only (QA row 16)', () => {
  vi.stubGlobal('window', {});
  dropTabArrival();
  try { saveStorage('device').removeItem('titleArrival.once'); } catch { /* no device storage here */ }
  setTitleArrival({ slug: 'driftwood-isle', mode: 'enter' }, { tab: true });
  expect(saveStorage('device').getItem('titleArrival.once'), 'another tab finds nothing to enter with').toBeNull();
  expect(pendingTitleArrival('driftwood-isle')).toEqual({ slug: 'driftwood-isle', mode: 'enter' });
  dropTabArrival();
  expect(pendingTitleArrival('driftwood-isle')).toBeNull();
});

test('Explore opens a selected zone in the hub by default and retains an explicit view', () => {
  expect(Object.fromEntries(exploreBootParams(new URLSearchParams('chunk=driftwood-isle')))).toEqual({ chunk: 'driftwood-isle', explore: 'hub' });
  const link = new URLSearchParams('chunk=mossgate&explore=model&model=oak&tier=phone');
  expect(exploreBootParams(link).toString()).toBe(link.toString());
});

test('the Explore path chooses the shard and retains the view coordinates and model', () => {
  const slug = exploreSlugOfPath('/driftwood-isle/');
  expect(slug).toBe('driftwood-isle');
  expect(exploreSlugOfPath('/blender-template')).toBe('brasscap-mesa');
  for (const path of ['/', '/b/c', '/version.json', '/%2f']) expect(exploreSlugOfPath(path)).toBeNull();
  const query = new URLSearchParams('explore=world&cam=16,32,64,0.5,0.1&model=tree&chunk=wrong');
  expect(Object.fromEntries(exploreBootParams(query, slug ?? undefined))).toEqual({
    explore: 'world', cam: '16,32,64,0.5,0.1', model: 'tree', chunk: 'driftwood-isle',
  });
});

// CHUNK-PARAM CP1 (J522): the tap names the zone; the address the tap leaves for is a bare `/`.
test('a tap on a bare / names its zone: the receiving page reads it with no slug, and spends it once', () => {
  handoffs(10_010);
  expect(pendingTitleArrival(), 'the bare page reads the zone from the tap').toEqual({ slug: 'driftwood-isle', mode: 'enter' });
  expect(pendingTitleArrival('sunscar-dunes'), 'a slug still narrows it').toBeNull();
  expect(consumeTitleArrival()).toEqual({ slug: 'driftwood-isle', mode: 'enter' });
  expect(pendingTitleArrival(), 'consumed with its device copy').toBeNull();
});

test('a tap record with no usable zone names none', () => {
  vi.stubGlobal('window', {});
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  try { saveStorage('session').setItem('titleArrival', JSON.stringify({ slug: '../x', mode: 'enter', at: 10_000 })); } catch { /* kept in memory, not persisted, in node */ }
  expect(pendingTitleArrival()).toBeNull();
  expect(consumeTitleArrival()).toBeNull();
});

test("the tap's device copy is taken only by the document the tap navigated, never another tab's / inside the minute", () => {
  const origin = 'https://play.example';
  expect(tapNavigatedHere({ referrer: `${origin}/leave?to=%2F`, origin, type: 'navigate' }), 'the tap navigated here (through the leave page)').toBe(true);
  expect(tapNavigatedHere({ referrer: `${origin}/`, origin, type: undefined })).toBe(true);
  expect(tapNavigatedHere({ referrer: '', origin, type: 'navigate' }), 'a second tab, a bookmark or a typed address').toBe(false);
  expect(tapNavigatedHere({ referrer: 'https://elsewhere.example/', origin, type: 'navigate' }), 'a link from another site').toBe(false);
  expect(tapNavigatedHere({ referrer: `${origin}/`, origin, type: 'reload' }), "the player's reload").toBe(false);
  expect(tapNavigatedHere({ referrer: `${origin}/`, origin, type: 'back_forward' })).toBe(false);
});

test('travel leaves for a bare / with the harness flags it keeps, never naming the zone', () => {
  const at = (href: string, mode: 'enter' | 'explore' = 'enter'): string => { const url = travelAddress({ mode }, href); return `${url.pathname}${url.search}`; };
  expect(at('https://play.example/')).toBe('/');
  expect(at('https://play.example/?chunk=pine-hollow&mute=1&nolock=1&skipintro=1&at=1,2,3,0,0&glreload=1&v=9')).toBe('/?mute=1&nolock=1');
  expect(at('https://play.example/slug/pine-hollow?sw=0'), 'a /slug/ page leaves for /').toBe('/?sw=0');
  expect(at('https://play.example/?tier=phone', 'explore')).toBe('/?tier=phone&explore=hub');
});

test('a tap is the writer\'s and the next document\'s only: the first other page to read it takes it, a later page finds it taken', () => {
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  const started = vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(9_000);
  dropTabArrival();
  setTitleArrival({ slug: 'pine-hollow', mode: 'enter' }, { tab: true });
  expect(pendingTitleArrival(), 'the tapping document still reads its own tap').toEqual({ slug: 'pine-hollow', mode: 'enter' });
  started.mockReturnValue(9_500);
  expect(pendingTitleArrival(), 'the page the tap navigated takes it').toEqual({ slug: 'pine-hollow', mode: 'enter' });
  expect(pendingTitleArrival('pine-hollow'), 'and keeps reading it').toEqual({ slug: 'pine-hollow', mode: 'enter' });
  started.mockReturnValue(9_900);
  expect(pendingTitleArrival(), 'a later page in the tab (the title after an exit, a reload) finds it taken').toBeNull();
  expect(consumeTitleArrival(), 'and never spends it as its own').toBeNull();
});
