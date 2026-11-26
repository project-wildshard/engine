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
  [null, true],
  ['driftwood-isle', false],
  ['brasscap-mesa', false],
])('CP22 (J522): a load handed zone %s boots a world only with that zone (titleOnly %s); no address picks a level', (zone, titleOnly) => {
  expect(bootRoute(zone, { line: '', level: '' })).toEqual({ rescue: false, titleOnly });
});

test('interrupted explicit level entry still returns to the title', () => {
  expect(bootRoute('driftwood-isle', { line: 'interrupted', level: 'driftwood-isle' })).toEqual({ rescue: true, titleOnly: true });
});

test('CP4: the WebKit rescue compares the zone this load boots (the tap the boot adopted), not the address', () => {
  expect(bootRoute('pine-hollow', { line: 'interrupted', level: 'pine-hollow' })).toEqual({ rescue: true, titleOnly: true });
  expect(bootRoute('pine-hollow', { line: 'interrupted', level: 'glowfen' }).rescue, 'another zone than the one that died').toBe(false);
  expect(bootRoute(null, { line: 'interrupted', level: 'glowfen' }), 'no zone: the title, no rescue').toEqual({ rescue: false, titleOnly: true });
});

test('explicit RELOAD returns to title even with a zone in hand', () => {
  expect(bootRoute('driftwood-isle', { line: '', level: '', reload: true })).toEqual({ rescue: true, titleOnly: true });
});

test('an online build enters a level only from a tap (QA row 16)', () => {
  const at = (query: string): URLSearchParams => new URLSearchParams(query);
  expect(onlineTitleFirst(at(''), 'driftwood-isle', true, false), 'a zone with no tap lands on the title').toBe(true);
  expect(onlineTitleFirst(at(''), 'driftwood-isle', true, true), 'a title tap or grid intent enters').toBe(false);
  expect(onlineTitleFirst(at('skipintro=1'), 'driftwood-isle', true, false), 'a harness that skips the title enters').toBe(false);
  expect(onlineTitleFirst(at('tour=1'), 'driftwood-isle', true, false)).toBe(false);
  // QA-FEEDBACK-2026-11-13 rows 6 and 13 (WILDSHARD-GAME-8H): the engine's own reload (GPU recovery, RELOAD HERE, the reload
  // prompt) carries ?glreload and returns to the world, not the title; play.ts strips it once read, so a reopened tab has none
  expect(onlineTitleFirst(at('glreload=1&at=1,2,3,0,0'), 'driftwood-isle', true, false), 'GPU recovery returns to the world').toBe(false);
  expect(onlineTitleFirst(at('glreload=1'), null, true, false), 'a grid page recovery reload too').toBe(false);
  expect(onlineTitleFirst(at(''), 'driftwood-isle', false, false), 'the solo build enters the zone it was handed').toBe(false);
  expect(onlineTitleFirst(at(''), null, true, false), 'the plain title is the title already').toBe(false);
  // CP22 (J522): an old link's zone is ignored: the boot never hands it on, so the load is the plain title
  expect(onlineTitleFirst(at('chunk=driftwood-isle'), null, true, false), 'an old link is the plain title').toBe(false); // chunk-param-guard: old link
  expect(onlineTitleFirst(at('utm_source=bookmark'), null, true, false), 'a setting selects no level').toBe(false);
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
  expect(Object.fromEntries(exploreBootParams(new URLSearchParams('')))).toEqual({ explore: 'hub' });
  const link = new URLSearchParams('explore=model&model=oak&tier=phone');
  expect(exploreBootParams(link).toString()).toBe(link.toString());
});

test('the Explore path chooses the shard and retains the view coordinates and model', () => {
  const slug = exploreSlugOfPath('/driftwood-isle/');
  expect(slug).toBe('driftwood-isle');
  expect(exploreSlugOfPath('/blender-template')).toBe('brasscap-mesa');
  for (const path of ['/', '/b/c', '/version.json', '/%2f']) expect(exploreSlugOfPath(path)).toBeNull();
  const query = new URLSearchParams('explore=world&cam=16,32,64,0.5,0.1&model=tree');
  expect(Object.fromEntries(exploreBootParams(query)), 'the path names the zone (entry.ts), the query only the view').toEqual({
    explore: 'world', cam: '16,32,64,0.5,0.1', model: 'tree',
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
  expect(at('https://play.example/?chunk=pine-hollow&mute=1&nolock=1&skipintro=1&at=1,2,3,0,0&glreload=1&v=9')).toBe('/?mute=1&nolock=1'); // chunk-param-guard: old link
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

const leavePages = (): void => { Reflect.deleteProperty(globalThis, 'document'); Reflect.deleteProperty(globalThis, 'location'); };
/** QA 11-25 row 90: a page in the tab, `referrer` its address's (empty for a bookmark or a harness URL) and `at` its start. */
function pageAt(at: number, referrer: string): void {
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(at);
  Reflect.set(globalThis, 'document', { referrer });
  Reflect.set(globalThis, 'location', { origin: 'https://play.example' });
}

test('QA 11-25 row 90: an in-page travel\'s tap is spent on a page no tap navigated, so Exit to the main menu lands on the title', () => {
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  try {
    dropTabArrival(); saveStorage('device').removeItem('titleArrival.once');
    pageAt(9_000, ''); // a bookmark or a harness URL: the page the player crosses Pine Hollow -> Mossgate on
    setTitleArrival({ slug: 'mossgate', mode: 'enter' }); // travel.ts arriveAt, as an in-page entry writes it (both copies)
    expect(pendingTitleArrival(), 'the in-page entry reads its own tap').toEqual({ slug: 'mossgate', mode: 'enter' });
    expect(consumeTitleArrival('mossgate'), 'and the session spends it').toEqual({ slug: 'mossgate', mode: 'enter' });
    pageAt(9_500, 'https://play.example/leave?to=%2F'); // the title the Exit replaces it with, seconds later
    expect(pendingTitleArrival(), 'no copy is left for the title to re-enter Mossgate with').toBeNull();
  } finally { leavePages(); }
});

test('QA 11-25 row 90: the player\'s Exit drops a tap its page wrote and never spent; another tab\'s stays', async () => {
  const { exitSessionToTitle } = await import('../src/client/game/session/exitToTitle');
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  try {
    dropTabArrival(); saveStorage('device').removeItem('titleArrival.once');
    pageAt(9_000, '');
    setTitleArrival({ slug: 'mossgate', mode: 'enter' });
    const replace = vi.fn<(url: string) => void>();
    exitSessionToTitle({ url: 'https://play.example/?mute=1', replace });
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://play.example/');
    pageAt(9_500, 'https://play.example/leave?to=%2F');
    expect(pendingTitleArrival(), 'the title after Exit').toBeNull();

    pageAt(9_600, '');
    setTitleArrival({ slug: 'pine-hollow', mode: 'enter' }); // another tab's fresh tap, its device copy
    dropTabArrival(); // (the other tab's session copy is its own)
    pageAt(9_700, 'https://play.example/');
    exitSessionToTitle({ url: 'https://play.example/', replace });
    expect(saveStorage('device').getItem('titleArrival.once'), 'another tab\'s tap is not this Exit\'s to drop').not.toBeNull();
  } finally { leavePages(); }
});
