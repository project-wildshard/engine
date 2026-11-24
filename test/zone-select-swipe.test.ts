// @vitest-environment happy-dom
// QA-FEEDBACK 2026-11-23-b row 1 (Jake, ~11:10 to ~11:15 Cancún, staging v0.1.74 on his iPhone 17 Pro: "nothing can be swiped lol
// on the new zone select", "I have to tab the carousel mini cards lol swipe should work", "the all section in zone select has no
// scrolling behavior no touch scrolling"). J468's swipe deck is a full-bleed hero with the zone's name in a thin band: a swipe
// anywhere on it steps the deck, a press on a control stays the control's, and a list tab's rows carry [data-scroll] so
// index.html's touchmove guard lets them scroll.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleDeck, titleCards, type TitleDeck } from '../src/client/game/titleDeck';
import type { MenuMode } from '../src/client/game/grid/menu';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';

const ART = { thumb: '', portrait: '', landscape: '' };
const ROWS: readonly TitleManifest[] = [
  { slug: 'driftwood-isle', name: 'Driftwood Isle', biome: 'Island', status: 'live', card: ART },
  { slug: 'pine-hollow', name: 'Pine Hollow', biome: 'Forest', status: 'live', card: ART },
  { slug: 'nalati-grasslands', name: 'Nalati Grasslands', biome: 'Grass', status: 'live', card: ART },
];
const PLAYER: MenuMode = { developer: false, devserver: false };
const decks: TitleDeck[] = [];
beforeEach(() => { installCatalogue(catalogueBeforePlacements); installTitleManifests(ROWS); });
afterEach(() => { for (const deck of decks.splice(0)) deck.dispose(); document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });

function deck(): TitleDeck {
  const cards = titleCards(false, () => null, () => null, () => true).filter(card => ROWS.some(row => row.slug === card.slug));
  expect(cards.length).toBe(3);
  const made = buildTitleDeck({ cards, active: null, onEnter: () => undefined, mode: () => PLAYER, strip: 4,
    tabs: [{ id: 'featured', label: 'Featured', cards }, { id: 'all', label: 'All', cards, list: true }], tab: 'featured' });
  document.body.append(made.root); decks.push(made);
  return made;
}
const lit = (d: TitleDeck): number => [...d.root.querySelectorAll('.ws-menu-card')].findIndex(card => card.classList.contains('selected'));
/** A finger: down at x0, ten moves to x1, up; on `at`, as a phone's touch pointer. */
function swipe(at: Element, x0: number, x1: number, y = 400): void {
  const fire = (type: string, x: number): void => { at.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 })); };
  fire('pointerdown', x0);
  for (let k = 1; k <= 10; k++) fire('pointermove', x0 + (x1 - x0) * k / 10);
  fire('pointerup', x1);
}

test('a swipe on the hero, on the zone name and on the mini heroes each steps the deck one zone', () => {
  const d = deck();
  expect(lit(d)).toBe(0);
  swipe(d.root.querySelector('.ws-menu-hero') ?? d.root, 330, 70);
  expect(lit(d), 'over the full-bleed hero, where the old band-only surface missed').toBe(1);
  swipe(d.root.querySelector('.ws-menu-cards') ?? d.root, 330, 70);
  expect(lit(d), 'over the name band').toBe(2);
  swipe(d.root.querySelector('.ws-menu-dots') ?? d.root, 70, 330);
  expect(lit(d), 'over the mini heroes, back one').toBe(1);
});

// QA-FEEDBACK-2026-11-24 row 8 (Jake, ~12:15 Cancún: "it should be a full screen swipe"; the iOS Simulator showed a swipe on the
// zone's name, a button, refused): the name card and ENTER ZONE take a swipe too, once the finger has gone sideways; a tap stays theirs
test('a swipe that starts on the zone\'s name or on ENTER ZONE steps the deck; a tap on ENTER ZONE still enters', () => {
  let entered = 0;
  const cards = titleCards(false, () => null, () => null, () => true).filter(card => ROWS.some(row => row.slug === card.slug));
  const d = buildTitleDeck({ cards, active: null, onEnter: () => { entered++; }, mode: () => PLAYER, strip: 4,
    tabs: [{ id: 'featured', label: 'Featured', cards }, { id: 'all', label: 'All', cards, list: true }], tab: 'featured' });
  document.body.append(d.root); decks.push(d);
  swipe(d.root.querySelector('.ws-menu-card.selected b') ?? d.root, 330, 70);
  expect(lit(d), 'from the name text, which the old surface refused (a button)').toBe(1);
  swipe(d.root.querySelector('.ws-menu-play') ?? d.root, 330, 70);
  expect(lit(d), 'from ENTER ZONE').toBe(2);
  expect(entered, 'a swipe from ENTER ZONE enters nothing').toBe(0);
  const play = d.root.querySelector('.ws-menu-play');
  // a tap that wobbles a few pixels is still a tap
  swipe(play ?? d.root, 200, 206);
  expect(lit(d)).toBe(2);
});

test('a press that starts on a tab is that control\'s, never a swipe', () => {
  const d = deck();
  const tab = d.tabBar?.querySelector('.ws-menu-tab');
  expect(tab).toBeTruthy();
  swipe(tab ?? d.root, 330, 70);
  expect(lit(d)).toBe(0);
});

test('a list tab\'s rows carry [data-scroll] so a finger scrolls them; the carousel\'s do not', () => {
  const d = deck(), rows = d.root.querySelector<HTMLElement>('.ws-menu-cards');
  expect(rows?.dataset['scroll']).toBeUndefined();
  expect(d.tabBar).not.toBeNull();
  d.tabBar?.querySelector('.ws-menu-tab[data-tab="all"]')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', button: 0 }));
  expect(d.root.classList.contains('ws-menu-list')).toBe(true);
  expect(rows?.dataset['scroll']).toBe('');
  expect(rows?.closest('[data-scroll]')).toBe(rows);
});
