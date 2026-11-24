// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { finishFirstPlay, firstPlayPending, resetFirstPlay, dropFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { markNameAsked } from '@wildshard/engine/ui/namePrompt';
import { installShards } from './shard/list';
import { buildTitleMenu, installGridTitle, zoneTabs } from './mainMenu';
import { pageGridIntents } from './grid/intent';
import type { TitleCard } from './titleDeck';
import { GAME_STRINGS } from '../../shared/game/strings';
import { saveStorage } from '@wildshard/engine/saves/slots';
import type { ZoneSelectCard, ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';

/** Jake, 2026-11-12 09:03 Cancún ("That shard select insta loads driftwood bug is still here"): on a phone, SHARD SELECT
 *  went straight to "Loading Driftwood Isle". The MG5 first-play skip entered deck card 0 on every tap until the in-world
 *  toggle's DONE marked the device, so a phone that never pressed DONE never saw the deck. SHARD SELECT always opens the deck now; MG5's first-play
 *  card is armed by the card the player picks. */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const card = (slug: string, name: string): TitleCard => ({ slug, name, label: name, thumbnail: '', heroPortrait: '', heroLandscape: '' });
const CARDS = [card('driftwood-isle', 'Driftwood Isle'), card('nalati', 'Nalati')];
const tap = (el: Element | null): void => {
  if (el === null) throw new Error('missing tap target');
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

let ua: PropertyDescriptor | undefined;
const views: { dispose: () => void }[] = [];
beforeEach(() => {
  installShards([]);
  ua = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => IPHONE });
  markNameAsked();
});
afterEach(() => {
  if (ua === undefined) Reflect.deleteProperty(navigator, 'userAgent'); else Object.defineProperty(navigator, 'userAgent', ua);
  for (const view of views.splice(0)) view.dispose();
  resetFirstPlay(); dropFirstPlay(); document.body.replaceChildren();
});

/** the deck's entry paints the loading shell, then navigates two frames later (boot/shell.ts) */
const frames = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 120); });
const loading = (): boolean => document.querySelector('.ws-load[data-navigation]') !== null;

const menu = (onEnter: (c: TitleCard) => void) => {
  const view = buildTitleMenu({ cards: CARDS, active: null, onEnter, onSettings: () => undefined, onGrid: () => undefined });
  document.body.append(view.root); views.push(view);
  return view;
};

test('a preparation menu preserves the admitted grid tap; an ordinary title retires it', () => {
  const intents = pageGridIntents();
  intents.set({ instance: 'driftwood-isle', slug: 'driftwood-isle' });
  installGridTitle({ preserveIntent: true });
  expect(intents.pending('driftwood-isle')).toBe(true);
  installGridTitle();
  expect(intents.pending('driftwood-isle')).toBe(false);
});

test('a preparation menu keeps its own screen while the world creates another menu', () => {
  const first = menu(() => undefined);
  first.show('select');
  const second = menu(() => undefined);
  second.show('main');
  expect(first.screen).toBe('select');
  expect(second.screen).toBe('main');
});

test('preparation keeps the small hero off the mandatory world download connection', () => {
  const view = buildTitleMenu({ cards: CARDS, active: null, fullHero: false, readAhead: false,
    onEnter: () => undefined, onSettings: () => undefined, onGrid: () => undefined });
  views.push(view);
  const hero = view.root.querySelector<HTMLElement>('.ws-main-hero');
  expect(hero?.style.getPropertyValue('--ws-hero-square')).toContain('square-first');
  expect(hero?.style.getPropertyValue('--ws-hero-landscape')).toContain('landscape-first');
});

test('a late catalogue owner can await first-play naming without replacing the prompt', async () => {
  saveStorage('device').removeItem('nameAsked');
  const view = menu(() => undefined);
  tap(view.root.querySelector('.ws-main-select'));
  await vi.waitFor(() => { expect(document.querySelector('#ws-name-box')).not.toBeNull(); });
  let idle = false;
  const pending = (async (): Promise<void> => { await view.whenIdle(); idle = true; })();
  await Promise.resolve();
  expect(idle).toBe(false);
  const skip = document.querySelector<HTMLButtonElement>('.ws-name-skip');
  if (skip === null) throw new Error('Missing naming choice');
  skip.click(); await pending;
  expect(idle).toBe(true);
  expect(document.querySelector('#ws-name-box')).toBeNull();
});

for (const visit of ['a fresh phone (no first-play mark)', 'a return visit (first play done)'] as const) {
  test(`${visit}: SHARD SELECT opens the deck and nothing loads until a card is picked`, async () => {
    if (visit.startsWith('a return')) finishFirstPlay(); else resetFirstPlay();
    const onEnter = vi.fn<(c: TitleCard) => void>();
    const view = menu(onEnter);
    tap(view.root.querySelector('.ws-main-select'));
    await frames();
    expect(loading()).toBe(false);
    expect(onEnter).not.toHaveBeenCalled();
    expect(view.screen).toBe('select');
    // tapping SHARD SELECT again (the iOS repeat) still enters nothing
    tap(view.root.querySelector('.ws-main-select'));
    await frames();
    expect(loading()).toBe(false);
    expect(onEnter).not.toHaveBeenCalled();
    tap(view.root.querySelector('.ws-menu-play'));
    expect(loading()).toBe(true);
    await frames();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0]?.[0]?.slug).toBe('driftwood-isle');
    // MG5: a device with no mark still gets its first-play card in the shard it picked; a marked one never does
    expect(firstPlayPending('driftwood-isle')).toBe(visit.startsWith('a fresh'));
  });
}

test('a fresh phone that picks another card gets its first-play card there, and nothing loads before the pick', async () => {
  resetFirstPlay();
  const onEnter = vi.fn<(c: TitleCard) => void>();
  const view = menu(onEnter);
  tap(view.root.querySelector('.ws-main-select'));
  await frames();
  expect(view.screen).toBe('select'); expect(view.index).toBe(0); expect(loading()).toBe(false);
  view.select(1, false);
  tap(view.root.querySelector('.ws-menu-play'));
  await frames();
  expect(onEnter.mock.calls.map(([c]) => c.slug)).toEqual(['nalati']);
  expect(firstPlayPending('nalati')).toBe(true); expect(firstPlayPending('driftwood-isle')).toBe(false);
});

/** MAIN-SCREEN MS1 (J387, J399: "a call to action that's like enter the MMO. And below it is just like a select a zone"): every
 *  player gets one ENTER THE MMO, the grid's entry (Developer no longer gates it), and one ZONE SELECT that opens the deck. The
 *  Infinite Wildshard card and its EXPERIMENTAL tag are gone; `.ws-main-grid` stays ENTER THE MMO's hook for the proof scripts. */
for (const developer of [false, true]) {
  test(`MS1: Developer ${developer ? 'on' : 'off'}: one ENTER THE MMO enters the grid, one ZONE SELECT opens the deck`, async () => {
    const onGrid = vi.fn<() => void>(), onEnter = vi.fn<(c: TitleCard) => void>();
    const view = buildTitleMenu({ cards: CARDS, active: null, onEnter, onSettings: () => undefined, onGrid,
      mode: () => ({ developer, devserver: false }) });
    document.body.append(view.root); views.push(view);
    const mmo = view.root.querySelectorAll('.ws-main-mmo'), zone = view.root.querySelectorAll('.ws-main-select');
    expect([mmo.length, zone.length]).toEqual([1, 1]);
    expect(mmo[0]?.classList.contains('ws-main-grid')).toBe(true);
    expect(mmo[0]?.querySelector('b')?.textContent).toBe('ENTER THE MMO');
    expect(zone[0]?.querySelector('b')?.textContent).toBe('ZONE SELECT');
    // ZS10 (J468): the tabs are Zone Select's header; Developer adds ALL (J469)
    expect(view.root.querySelector('.ws-menu-title')).toBeNull();
    expect([...view.root.querySelectorAll('.ws-menu-tab')].map(t => t.textContent)).toEqual(developer ? ['FEATURED', 'POPULAR', 'NEW', 'ALL'] : ['FEATURED', 'POPULAR', 'NEW']);
    expect(view.root.textContent).not.toMatch(/infinite wildshard|experimental|shard select/iu);
    mmo[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await frames();
    expect(onGrid).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
    tap(zone[0] ?? null);
    await frames();
    expect(view.screen).toBe('select');
  });
}

/** MAIN-SCREEN MS1 review: the title's confirm is every key (inputContexts `confirm: ['*']`), so on the main screen it opens ZONE
 *  SELECT, which loads nothing; only a click on ENTER THE MMO (Enter / Space on it focused) starts the MMO's download. */
test('MS1: any key on the main screen opens ZONE SELECT and never enters the MMO', async () => {
  const onGrid = vi.fn<() => void>();
  const view = buildTitleMenu({ cards: CARDS, active: null, onEnter: () => undefined, onSettings: () => undefined,
    onGrid, screen: 'main', mode: () => ({ developer: false, devserver: false }) });
  document.body.append(view.root); views.push(view);
  expect(view.screen).toBe('main');
  view.activate();
  await frames();
  expect(onGrid).not.toHaveBeenCalled();
  expect(view.screen).toBe('select');
});

/** STAGING-BUGBASH SB49 (staging, 2026-11-18 ~17:21 UTC, WebKit and Chromium): ENTER ZONE sometimes ended on "Navigation shell
 *  requires a live owner", and a second tap worked. On a world build the tap first asks the world (the title gate, seconds on a
 *  phone); the published cards landing meanwhile rebuilt the title (entry.ts awaits `whenIdle`, then `refresh` disposes this menu),
 *  so the gate's `go` reached a disposed deck. A held tap, and an entry under way, keep the menu busy. */
const gated = (onEnter: (c: TitleCard) => void) => {
  const held: { go: () => void; settle: () => void }[] = [];
  const errors: unknown[] = [];
  let asking: Promise<void> | null = null;
  const view = buildTitleMenu({ cards: CARDS, active: null, onEnter, onSettings: () => undefined, onGrid: () => undefined,
    // one tap at a time, as entry.ts's gate: a second tap while the first is asked enters nothing
    gate: (go) => {
      asking ??= new Promise<void>((resolve) => { held.push({ go: () => { try { go(); } catch (error) { errors.push(error); } }, settle: resolve }); })
        .finally(() => { asking = null; });
      return asking;
    } });
  document.body.append(view.root); views.push(view);
  // entry.ts's late catalogue owner: wait for the menu, then replace it
  let refreshed = false;
  const lateCatalogue = (): void => { void view.whenIdle().then(() => { refreshed = true; view.dispose(); return undefined; }); };
  return { view, held, errors, lateCatalogue, refreshed: () => refreshed };
};

test('SB49: a late catalogue refresh waits for the ENTER ZONE the world gate holds, then never replaces the leaving title', async () => {
  finishFirstPlay();
  const onEnter = vi.fn<(c: TitleCard) => void>();
  const { view, held, errors, lateCatalogue, refreshed } = gated(onEnter);
  tap(view.root.querySelector('.ws-main-select'));
  await frames();
  tap(view.root.querySelector('.ws-menu-play'));
  expect(held).toHaveLength(1);
  lateCatalogue();
  await frames();
  expect(refreshed()).toBe(false);
  held[0]?.go(); held[0]?.settle();
  await frames();
  expect(errors).toEqual([]);
  expect(onEnter.mock.calls.map(([c]) => c.slug)).toEqual(['driftwood-isle']);
  expect(refreshed()).toBe(false);
});

test('SB49: a held ENTER ZONE the player cancels lets the late catalogue refresh run', async () => {
  finishFirstPlay();
  const onEnter = vi.fn<(c: TitleCard) => void>();
  const { view, held, lateCatalogue, refreshed } = gated(onEnter);
  tap(view.root.querySelector('.ws-main-select'));
  await frames();
  tap(view.root.querySelector('.ws-menu-play'));
  lateCatalogue();
  await frames();
  expect(refreshed()).toBe(false);
  held[0]?.settle();
  await frames();
  expect(refreshed()).toBe(true);
  expect(onEnter).not.toHaveBeenCalled();
});

// QA 11-23 row 8 (Jake, an update boot "frozen"): ENTER THE MMO sweeps while the world gate asks, and once the title leaves a
// bar sweeps along the top until the page goes; a held tap the gate lets go of stops sweeping
test('row 8: ENTER THE MMO is busy while the gate asks, and leaving puts up the sweeping bar', async () => {
  finishFirstPlay();
  const { view, held } = gated(() => undefined);
  const mmo = view.root.querySelector('.ws-main-mmo');
  tap(mmo);
  await frames();
  expect(held).toHaveLength(1);
  expect(mmo?.getAttribute('aria-busy')).toBe('true');
  expect(document.querySelector('.ws-main-leaving')).toBeNull();
  held[0]?.go(); held[0]?.settle();
  await frames();
  expect(mmo?.getAttribute('aria-busy')).toBe('true'); // leaving: it stays busy until the page goes
  expect(view.root.querySelectorAll('.ws-main-leaving')).toHaveLength(1);
});

test('row 8: a gate that holds the MMO tap without leaving clears its busy state', async () => {
  finishFirstPlay();
  const { view, held } = gated(() => undefined);
  const mmo = view.root.querySelector('.ws-main-mmo');
  tap(mmo);
  await frames();
  held[0]?.settle();
  await frames();
  expect(mmo?.hasAttribute('aria-busy')).toBe(false);
  expect(document.querySelector('.ws-main-leaving')).toBeNull();
});

// meta EXPLORE-MODE EX1 (J460, QA 2026-11-19 rows 47 and 48; Jake ~14:17: "In Zone Select, we can now hide the Explore button";
// ~14:18: "We don't need the settings button here underneath enter zone"): ZONE SELECT has neither, in every mode
for (const [name, mode] of [['player', { developer: false, devserver: false }], ['Developer', { developer: true, devserver: false }], ['DEVSERVER', { developer: false, devserver: true }]] as const) {
  test(`ZONE SELECT shows no EXPLORE WORLD and no SETTINGS (${name}); the home screen keeps SETTINGS`, () => {
    const view = buildTitleMenu({ cards: CARDS, active: null, onEnter: () => undefined, onSettings: () => undefined, onGrid: () => undefined, mode: () => mode });
    document.body.append(view.root); views.push(view);
    view.show('select');
    expect(view.root.querySelector('.ws-menu-explore')).toBeNull();
    expect(view.root.querySelector('.ws-menu-settings')).toBeNull();
    expect(view.root.querySelector('.ws-menu-play')).not.toBeNull();
    expect(view.root.querySelector('.ws-main-settings:not(.ws-main-signin)')?.textContent).toBe(GAME_STRINGS.mainMenu.settings);
  });
}

/** ZS10 (J461, J468, J469; Jake's look on board https://claude.ai/artifact/FDzM6sgRKvnRnx9xCcV2c9): Zone Select's tabs read the room
 *  list's orders; FEATURED opens; 4 mini heroes slide as a window; the stripe pager and "1 / 8"; Developer's ALL is a list. */
const zone = (slug: string): ZoneSelectCard => ({ slug, name: slug, status: null, heroHash: null, firstUploadedAt: null, enters: 0 });
const SIX = ['a-one', 'b-two', 'c-three', 'd-four', 'e-five', 'f-six'].map(slug => card(slug, slug.toUpperCase()));
const served = (featured: string[], popular: string[], fresh: string[], all: string[]): ZoneSelectDocument =>
  ({ channel: 'staging', serial: 1, featured: featured.map(zone), popular: popular.map(zone), new: fresh.map(zone), all: all.map(zone) });
const DOC = served(['c-three', 'a-one', 'b-two', 'd-four', 'e-five', 'f-six'], ['f-six', 'a-one'], ['e-five'], ['b-two', 'a-one', 'zz-missing']);
const zoneMenu = (developer: boolean, zoneSelect: ZoneSelectDocument | null = DOC) => {
  const view = buildTitleMenu({ cards: SIX, zoneSelect, active: null, onEnter: () => undefined, onSettings: () => undefined, onGrid: () => undefined,
    mode: () => ({ developer, devserver: false }) });
  document.body.append(view.root); views.push(view);
  view.show('select');
  return view;
};
const names = (root: ParentNode): string[] => [...root.querySelectorAll('.ws-menu-card b')].map(b => b.textContent ?? '');
const pressTab = (root: ParentNode, id: string): void => { tap(root.querySelector(`.ws-menu-tab[data-tab="${id}"]`)); };

test('ZS10: Zone Select opens on FEATURED in its served order; each tab shows its own cards', () => {
  const view = zoneMenu(false);
  expect(view.root.querySelector('.ws-menu-tab[aria-selected="true"]')?.textContent).toBe('FEATURED');
  expect(names(view.root)).toEqual(['C-THREE', 'A-ONE', 'B-TWO', 'D-FOUR', 'E-FIVE', 'F-SIX']);
  pressTab(view.root, 'popular');
  expect(names(view.root)).toEqual(['F-SIX', 'A-ONE']);
  expect(view.cards.map(c => c.slug)).toEqual(['f-six', 'a-one']);
  pressTab(view.root, 'new');
  expect(names(view.root)).toEqual(['E-FIVE']);
  expect(view.root.querySelector('.ws-menu-tab[data-tab="all"]')).toBeNull();
});

test('ZS10: an empty tab says so and ENTER ZONE is off; FEATURED with no room list holds the build\'s cards', () => {
  const view = zoneMenu(false, served(['c-three'], [], [], []));
  pressTab(view.root, 'new');
  expect(view.root.querySelector('.ws-menu-empty')?.textContent).toBe(GAME_STRINGS.mainMenu.tabs.empty);
  expect(view.root.querySelector<HTMLButtonElement>('.ws-menu-play')?.disabled).toBe(true);
  const bare = zoneMenu(false, null);
  pressTab(bare.root, 'featured');
  expect(names(bare.root)).toEqual(SIX.map(c => c.name));
});

test('ZS10: J468\'s 4 mini heroes slide as a window, with the stripe pager and "1 / 6"', () => {
  const view = zoneMenu(false);
  pressTab(view.root, 'featured'); // the page keeps the last tab (a rebuild comes back to it)
  const count = (): string | null | undefined => view.root.querySelector('.ws-menu-count')?.textContent;
  const lit = (sel: string): number => [...view.root.querySelectorAll(sel)].findIndex(e => e.classList.contains('on'));
  const windows: number[] = [];
  const strip = view.root.querySelector<HTMLElement>('.ws-menu-dots');
  if (strip === null) throw new Error('no strip');
  strip.scrollTo = ((opts: ScrollToOptions): void => { windows.push(opts.left ?? -1); }) as typeof strip.scrollTo;
  view.root.querySelectorAll<HTMLElement>('.ws-menu-dots i').forEach((dot, i) => { Object.defineProperty(dot, 'offsetLeft', { get: () => i * 100 }); });
  expect(count()).toBe('1 / 6');
  expect(view.root.querySelectorAll('.ws-menu-stripes i')).toHaveLength(6);
  for (const i of [1, 2, 3, 5, 0]) view.select(i, false);
  expect(windows).toEqual([0, 100, 200, 200, 0]); // [0] 1 2 3 · 0 [1] 2 3 · 1 [2] 3 4 · 2 [3] 4 5 · 2 3 4 [5] · [0] 1 2 3
  expect([count(), lit('.ws-menu-stripes i'), lit('.ws-menu-dots i')]).toEqual(['1 / 6', 0, 0]);
  view.select(3, false);
  expect([count(), lit('.ws-menu-stripes i'), lit('.ws-menu-dots i')]).toEqual(['4 / 6', 3, 3]);
  // no live badge and no summary block: the zone's line carries its feats
  expect(view.root.querySelector('.ws-title-summary')).toBeNull();
  expect(view.root.querySelector('.ws-menu-card.selected small')?.textContent).toBe('D-FOUR · 0 FEATS');
});

test('ZS10: Developer\'s ALL (J469) is a list of every zone, served order first, then the build\'s others; the tab survives a rebuild', () => {
  const view = zoneMenu(true);
  pressTab(view.root, 'all');
  expect(view.root.querySelector('.ws-menu-list')).not.toBeNull();
  // a draft (Thin Ice) follows, as on today's Developer deck
  expect(names(view.root).slice(0, 6)).toEqual(['B-TWO', 'A-ONE', 'C-THREE', 'D-FOUR', 'E-FIVE', 'F-SIX']);
  tap(view.root.querySelector('.ws-menu-card[data-i="4"]'));
  expect(view.index).toBe(4);
  expect(view.root.querySelector('.ws-menu-caption b')?.textContent).toBe('E-FIVE');
  const again = zoneMenu(true);
  expect(again.root.querySelector('.ws-menu-tab[aria-selected="true"]')?.textContent).toBe('ALL');
  const player = zoneMenu(false);
  expect(player.root.querySelector('.ws-menu-tab[aria-selected="true"]')?.textContent).toBe('FEATURED');
  pressTab(player.root, 'featured');
});

// QA 11-23-b row 26 (J453, J498): staging v0.1.76 placed the hidden test shards Pastel Plain and Ink-Cel Valley on the grid, and
// Popular and New listed them. However a door or a kept list serves them, no player tab names a hidden or test shard; ALL does.
test('row 26: with no door answer (preview, a `?chunk=` boot) a hidden shard\'s card stays on Featured, so ENTER enters it', () => {
  // main ci 45298253323 (boundaries): cook-to-play boots hidden Brasscap Mesa by its route; with its card filtered off Featured,
  // ENTER entered Signal Dunes and the page navigated away under the gameplay wait.
  const hiddenCard = { ...card('g-seven', 'G-SEVEN'), badge: 'Developer only' as const };
  const view = buildTitleMenu({ cards: [...SIX, hiddenCard], active: null, onEnter: () => undefined, onSettings: () => undefined,
    onGrid: () => undefined, mode: () => ({ developer: false, devserver: false }) });
  document.body.append(view.root); views.push(view); view.show('select');
  pressTab(view.root, 'featured');
  expect(names(view.root)).toContain('G-SEVEN');
  expect(zoneTabs([...SIX, hiddenCard], undefined, false).map(tab => tab.cards.some(row => row.slug === 'g-seven'))).toEqual([true, true, true]);
});
test('row 26: a hidden or test shard is on no player tab, even served and placed; Developer\'s ALL still lists it', () => {
  const tester = (slug: string, status: string | null = null): ZoneSelectCard => ({ ...zone(slug), status });
  const leaky: ZoneSelectDocument = { channel: 'staging', serial: 1,
    featured: [zone('a-one'), tester('pastel-plain'), tester('proof-town')],
    popular: [tester('pastel-plain'), tester('ink-cel-valley'), zone('a-one'), tester('c-three', 'hidden')],
    new: [tester('ink-cel-valley'), tester('_template'), zone('b-two'), tester('open-plot-thin-ice')],
    all: [zone('a-one'), tester('c-three', 'hidden')] };
  const cards = [...SIX, card('pastel-plain', 'PASTEL PLAIN'), card('ink-cel-valley', 'INK-CEL VALLEY'), card('proof-town', 'PROOF TOWN'),
    { ...card('g-seven', 'G-SEVEN'), badge: 'Developer only' as const }];
  const leakyMenu = (developer: boolean) => {
    const view = buildTitleMenu({ cards, zoneSelect: leaky, active: null, onEnter: () => undefined, onSettings: () => undefined,
      onGrid: () => undefined, mode: () => ({ developer, devserver: false }) });
    document.body.append(view.root); views.push(view); view.show('select');
    return view;
  };
  const player = leakyMenu(false);
  pressTab(player.root, 'featured');
  expect(names(player.root)).toEqual(['A-ONE']);
  pressTab(player.root, 'popular');
  expect(names(player.root)).toEqual(['A-ONE']);
  pressTab(player.root, 'new');
  expect(names(player.root)).toEqual(['B-TWO']);
  const developer = leakyMenu(true);
  pressTab(developer.root, 'popular');
  expect(names(developer.root)).toEqual(['A-ONE']);
  pressTab(developer.root, 'all');
  expect(names(developer.root)).toEqual(expect.arrayContaining(['PASTEL PLAIN', 'INK-CEL VALLEY', 'C-THREE', 'G-SEVEN']));
  pressTab(developer.root, 'featured');
});
