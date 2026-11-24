// @vitest-environment happy-dom
// QA-FEEDBACK 2026-11-24 row 10 (Jake, ~12:25 Cancún, at the MacBook: "enter zone button is not instant"). Staging, Chromium, frame
// log from the press (tmp probe, enter-probe.mjs): with no heard restart the loading panel is the first frame (+14 ms); after a heard
// world restart ENTER ZONE asks the world first and showed nothing for 747 ms, its aria-busy had no look on the zone deck. The press
// must change what is on screen in the tap's own turn (the next frame paints it, well inside 100 ms): the loading panel, or a
// pressed, sweeping ENTER ZONE while the world is asked.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleDeck, titleCards, type TitleDeck } from '../src/client/game/titleDeck';
import type { MenuMode } from '../src/client/game/grid/menu';
import { titleGate } from '../src/client/app/titleGate';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';

const ART = { thumb: '', portrait: '', landscape: '' };
const ROWS: readonly TitleManifest[] = [
  { slug: 'driftwood-isle', name: 'Driftwood Isle', biome: 'Island', status: 'live', card: ART },
  { slug: 'pine-hollow', name: 'Pine Hollow', biome: 'Forest', status: 'live', card: ART },
];
const PLAYER: MenuMode = { developer: false, devserver: false };
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'k' };
const decks: TitleDeck[] = [];
beforeEach(() => { installCatalogue(catalogueBeforePlacements); installTitleManifests(ROWS); });
afterEach(() => { for (const deck of decks.splice(0)) deck.dispose(); document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });

function zoneDeck(gate?: (go: () => void) => Promise<void> | void): { deck: TitleDeck; play: HTMLButtonElement } {
  const cards = titleCards(false, () => null, () => null, () => true).filter(card => ROWS.some(row => row.slug === card.slug));
  const deck = buildTitleDeck({ cards, active: null, onEnter: () => undefined, mode: () => PLAYER, strip: 4,
    tabs: [{ id: 'featured', label: 'Featured', cards }], tab: 'featured', ...(gate === undefined ? {} : { gate }) });
  deck.root.classList.add('ws-menu-carousel', 'ws-menu-swipe');
  document.body.append(deck.root); decks.push(deck);
  const play = deck.root.querySelector<HTMLButtonElement>('.ws-menu-play');
  if (play === null) throw new Error('the deck has ENTER ZONE');
  return { deck, play };
}
const loadingShown = (): boolean => { const load = document.querySelector('.ws-load'); return load !== null && !load.classList.contains('hide'); };

test('ENTER ZONE with no heard restart shows the loading panel in the tap\'s own turn', () => {
  const { play } = zoneDeck(titleGate(WORLD, () => new Promise(() => undefined), () => false));
  const at = performance.now();
  play.click();
  expect(loadingShown(), 'the loading panel is up before the tap returns').toBe(true);
  expect(performance.now() - at).toBeLessThan(100);
});

test('ENTER ZONE after a heard restart presses and sweeps in the tap\'s own turn while the world is asked', () => {
  let loads = 0;
  const { play } = zoneDeck(titleGate(WORLD, () => { loads++; return new Promise(() => undefined); }, () => true));
  expect(loads, 'the gate\'s code is asked for before the tap').toBe(1);
  const at = performance.now();
  play.click();
  expect(play.getAttribute('aria-busy')).toBe('true');
  expect(performance.now() - at).toBeLessThan(100);
  // the busy state has a look on the zone deck (it had none: the 747 ms of nothing)
  const css = readFileSync('src/client/game/mainMenu.css', 'utf8');
  expect(css).toMatch(/\.ws-menu \.ws-menu-play\[aria-busy="true"\] \{[^}]*filter: brightness/u);
  expect(css).toMatch(/\.ws-menu \.ws-menu-play\[aria-busy="true"\]::after[^{]*\{[^}]*animation: ws-main-sweep/u);
});
