// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleDeck, titleCards, type TitleDeck } from '../src/client/game/titleDeck';
import type { MenuMode } from '../src/client/game/grid/menu';

/** J313 (Jake, 2026-11-12 ~23:05 Cancún, after GC21): Sky Reach and Signal Dunes enter for every player labelled EXPERIMENTAL,
 *  Nine Dragon labelled PARTIAL; Mossgate (`_template`) has a card for everyone; open plots have no card (players reach them by
 *  crossing the grid); the Thin Ice draft card, off the grid by J305, is Developer only. The rows are the live title rows'
 *  slug, status and `shardSelect` on staging v0.1.13 (each shard's own discovery); the catalogue is the one a release build
 *  bakes, `test/pins/catalogue.json`, whose placement statuses J313 sets. */
const ART = { thumb: '', portrait: '', landscape: '' };
const row = (slug: string, name: string, status: TitleManifest['status'], shardSelect?: false): TitleManifest =>
  ({ slug, name, biome: name, status, card: ART, ...(shardSelect === undefined ? {} : { shardSelect }) });
const ROWS: readonly TitleManifest[] = [
  row('driftwood-isle', 'Driftwood Isle', 'live'), row('pine-hollow', 'Pine Hollow', 'earlyAccess'),
  row('nalati-grasslands', 'Nalati Grasslands', 'earlyAccess'), row('nine-dragon-stack', 'Nine Dragon Stack', 'experimental'),
  row('blender-template', 'Brasscap Mesa', 'hidden'), row('pastel-plain', 'Pastel Plain', 'hidden', false),
  row('ink-cel-valley', 'Ink & Cel Valley', 'hidden', false), row('open-plot-night-market', 'Open Plot · Night Market', 'experimental', false),
  row('open-plot-thin-ice', 'Open Plot · Thin Ice', 'earlyAccess', false), row('open-plot-desert-ruin', 'Open Plot · Desert Ruin', 'hidden', false),
  row('open-plot-coral-drift', 'Open Plot · Coral Drift', 'earlyAccess', false),
  row('sunscar-dunes', 'Signal Dunes', 'experimental'), row('far-reach', 'Sky Reach', 'experimental'), row('_template', 'Template shard', 'hidden'),
];
const PLAYER: MenuMode = { developer: false, devserver: false };

const decks: TitleDeck[] = [];
beforeEach(() => { installCatalogue(JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8'))); });
afterEach(() => { for (const deck of decks.splice(0)) deck.dispose(); document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });
const deckOf = (showHidden: boolean, mode: MenuMode): TitleDeck => {
  installTitleManifests(ROWS);
  const deck = buildTitleDeck({ cards: titleCards(showHidden, () => null, () => null), active: null, onEnter: () => undefined,
    onExplore: () => undefined, onSettings: () => undefined, mode: () => mode });
  document.body.append(deck.root); decks.push(deck);
  return deck;
};
/** each card on the deck: its name, the tag over its picture, and whether ENTER WORLD enters it */
const view = (deck: TitleDeck): { name: string; tag: string; enters: boolean }[] => Array.from(deck.root.querySelectorAll('.ws-menu-card')).map((card) => ({
  name: card.querySelector('b')?.textContent ?? '',
  tag: card.querySelector('.ws-menu-card-exp')?.textContent ?? '',
  enters: card.querySelector('.ws-menu-card-tag:not(.ws-menu-card-needs)') !== null,
}));

test('J313: with Developer off, the three unlocked shards enter with their labels, Mossgate shows, no open plot or Thin Ice card', () => {
  const cards = view(deckOf(false, PLAYER));
  expect(cards).toEqual([
    { name: 'Driftwood Isle', tag: '', enters: true },
    { name: 'Pine Hollow', tag: 'Early access', enters: true },
    { name: 'Nalati Grasslands', tag: 'Early access', enters: true },
    { name: 'Nine Dragon Stack', tag: 'Partial', enters: true },
    { name: 'Signal Dunes', tag: 'Experimental', enters: true },
    { name: 'Sky Reach', tag: 'Experimental', enters: true },
    { name: 'Template shard', tag: '', enters: true },
  ]);
  expect(cards.some(({ tag }) => tag === 'Coming soon')).toBe(false);
  expect(cards.some(({ name }) => name.startsWith('Open Plot') || name === 'Thin Ice')).toBe(false);
  expect(decks[0]?.root.querySelector('.ws-menu-card-partial')?.textContent).toBe('Partial');
});

test('J313: ENTER WORLD reads Enter world, not Coming soon, on each unlocked card for a player', () => {
  const deck = deckOf(false, PLAYER);
  for (const slug of ['nine-dragon-stack', 'sunscar-dunes', 'far-reach', '_template']) {
    deck.select(deck.cards.findIndex((card) => card.slug === slug), false);
    expect(deck.root.querySelector('.ws-menu-play b')?.textContent).toBe('Enter world');
  }
});

test('J313: Developer still sees the Thin Ice draft and the hidden shards; open plots stay off the deck', () => {
  const names = view(deckOf(true, { developer: true, devserver: false })).map(({ name }) => name);
  expect(names).toContain('Thin Ice');
  expect(names).toContain('Brasscap Mesa');
  expect(names.some((name) => name.startsWith('Open Plot'))).toBe(false);
});

test('J313: the title summary counts Mossgate for a player, since its catalogue placement opens it', async () => {
  const { summaryView } = await import('../src/client/game/summary');
  const view = summaryView({ v: 1, shards: { _template: { earned: 2, total: null, playS: 10, at: 0 } } }, ROWS);
  expect(view.lines.map(({ slug }) => slug)).toContain('_template');
  expect(view.earned).toBe(2);
  expect(view.lines.some(({ slug }) => slug === 'blender-template')).toBe(false);
});
