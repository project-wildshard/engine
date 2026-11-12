// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { finishFirstPlay, firstPlayPending, resetFirstPlay, dropFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { markNameAsked } from '@wildshard/engine/ui/namePrompt';
import { installShards } from './shard/list';
import { buildTitleMenu } from './mainMenu';
import type { TitleCard } from './titleDeck';

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
