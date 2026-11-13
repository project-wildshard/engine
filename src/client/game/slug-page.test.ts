// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dropFirstPlay, resetFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { markNameAsked } from '@wildshard/engine/ui/namePrompt';
import { installShards } from './shard/list';
import { buildSlugPage } from './slugPage';
import type { TitleCard } from './titleDeck';
import type { TitleManifest } from './shard/titleList';

/** SA36 (Jake, grill 2026-11-12 Q14 to Q16): the `/slug/<slug>` page is Shard Select's deck with exactly one card. A placed slug's
 *  PLAY enters like ENTER WORLD (loading shell, then `onEnter`); a slug with no grid cell keeps its card and hero, PLAY disabled,
 *  "Not on the grid yet". */
const manifest = (slug: string, name: string): TitleManifest => ({ slug, name, biome: `${name} biome`, status: 'live',
  card: { thumb: `/t/${slug}.jpg`, portrait: `/p/${slug}.jpg`, landscape: `/l/${slug}.jpg` } });
const tap = (el: Element | null): void => {
  if (el === null) throw new Error('missing tap target');
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const frames = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 120); });
const loading = (): boolean => document.querySelector('.ws-load[data-navigation]') !== null;
const views: { dispose: () => void }[] = [];
beforeEach(() => { installShards([]); markNameAsked(); });
afterEach(() => { for (const view of views.splice(0)) view.dispose(); resetFirstPlay(); dropFirstPlay(); document.body.replaceChildren(); });

const page = (placed: boolean, onEnter: (card: TitleCard) => void) => {
  const view = buildSlugPage({ manifest: manifest('driftwood-isle', 'Driftwood Isle'), placed, onEnter, onExplore: () => undefined, onSettings: () => undefined });
  document.body.append(view.root); views.push(view); view.start();
  return view;
};
const play = (): HTMLButtonElement => {
  const button = document.querySelector('.ws-slug .ws-menu-play');
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing PLAY');
  return button;
};

test('a placed slug: one card, its hero, PLAY enters through the deck\'s loading shell', async () => {
  const onEnter = vi.fn<(c: TitleCard) => void>();
  const view = page(true, onEnter);
  expect(view.cards.map(c => c.slug)).toEqual(['driftwood-isle']);
  expect(document.querySelectorAll('.ws-slug .ws-menu-card')).toHaveLength(1);
  expect(document.querySelector('.ws-slug .ws-menu-card b')?.textContent).toBe('Driftwood Isle');
  expect((document.querySelector('.ws-slug .ws-menu-hero') as HTMLElement).style.backgroundImage).toContain('/t/driftwood-isle.jpg');
  expect([play().disabled, play().querySelector('b')?.textContent, play().querySelector('small')?.textContent]).toEqual([false, 'Play', 'Spawns you on the grid']);
  tap(play());
  expect(loading()).toBe(true);
  await frames();
  expect(onEnter.mock.calls.map(([c]) => c.slug)).toEqual(['driftwood-isle']);
});

test('a slug with no grid cell: the card and hero, PLAY disabled, "Not on the grid yet", and nothing enters', async () => {
  const onEnter = vi.fn<(c: TitleCard) => void>();
  const view = page(false, onEnter);
  expect(document.querySelector('.ws-slug .ws-menu-card b')?.textContent).toBe('Driftwood Isle');
  expect((document.querySelector('.ws-slug .ws-menu-hero') as HTMLElement).style.backgroundImage).toContain('/t/driftwood-isle.jpg');
  expect([play().disabled, play().querySelector('b')?.textContent, play().querySelector('small')?.textContent]).toEqual([true, 'Play', 'Not on the grid yet']);
  tap(play()); view.activate();
  await frames();
  expect(loading()).toBe(false);
  expect(onEnter).not.toHaveBeenCalled();
});

test('Developer on: still exactly one card (no draft cards), and an unplaced slug asks no name on the confirm key', async () => {
  const onEnter = vi.fn<(c: TitleCard) => void>();
  const view = buildSlugPage({ manifest: manifest('open-plot-thin-ice', 'Thin Ice'), placed: false, onEnter, onExplore: () => undefined, onSettings: () => undefined,
    mode: () => ({ developer: true, devserver: false }) });
  document.body.append(view.root); views.push(view); view.start();
  expect(document.querySelectorAll('.ws-slug .ws-menu-card')).toHaveLength(1);
  expect(document.querySelector('.ws-slug .ws-menu-card-tag')).toBeNull(); // no LOAD tag on a card PLAY can't enter
  expect([play().disabled, play().querySelector('small')?.textContent]).toEqual([true, 'Not on the grid yet']);
  view.activate();
  await frames();
  expect([loading(), onEnter.mock.calls.length]).toEqual([false, 0]);
});
