// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { finishFirstPlay, firstPlayPending, resetFirstPlay, dropFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { markNameAsked } from '@wildshard/engine/ui/namePrompt';
import { installShards } from './shard/list';
import { buildTitleMenu, installGridTitle } from './mainMenu';
import { pageGridIntents } from './grid/intent';
import type { TitleCard } from './titleDeck';
import { saveStorage } from '@wildshard/engine/saves/slots';

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
  const view = buildTitleMenu({ cards: CARDS, active: null, onEnter, onExplore: () => undefined, onSettings: () => undefined, onGrid: () => undefined });
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
    onEnter: () => undefined, onExplore: () => undefined, onSettings: () => undefined, onGrid: () => undefined });
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
    const view = buildTitleMenu({ cards: CARDS, active: null, onEnter, onExplore: () => undefined, onSettings: () => undefined, onGrid,
      mode: () => ({ developer, devserver: false }) });
    document.body.append(view.root); views.push(view);
    const mmo = view.root.querySelectorAll('.ws-main-mmo'), zone = view.root.querySelectorAll('.ws-main-select');
    expect([mmo.length, zone.length]).toEqual([1, 1]);
    expect(mmo[0]?.classList.contains('ws-main-grid')).toBe(true);
    expect(mmo[0]?.querySelector('b')?.textContent).toBe('ENTER THE MMO');
    expect(zone[0]?.querySelector('b')?.textContent).toBe('ZONE SELECT');
    expect(view.root.querySelector('.ws-menu-title')?.textContent).toBe('ZONE SELECT');
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
  const view = buildTitleMenu({ cards: CARDS, active: null, onEnter: () => undefined, onExplore: () => undefined, onSettings: () => undefined,
    onGrid, screen: 'main', mode: () => ({ developer: false, devserver: false }) });
  document.body.append(view.root); views.push(view);
  expect(view.screen).toBe('main');
  view.activate();
  await frames();
  expect(onGrid).not.toHaveBeenCalled();
  expect(view.screen).toBe('select');
});
