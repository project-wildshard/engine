// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleDeck, titleCards, type TitleDeck } from '../src/client/game/titleDeck';
import type { MenuMode } from '../src/client/game/grid/menu';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';

/** J313 (Jake, 2026-11-12 ~23:05 Cancún, after GC21): Sky Reach and Signal Dunes enter for every player labelled EXPERIMENTAL,
 *  Nine Dragon labelled PARTIAL; the Template had a card for everyone (J434 retired it); open plots have no card (players reach them by
 *  crossing the grid); the Thin Ice draft card, off the grid by J305, is Developer only. The rows are the live title rows'
 *  slug, status and `shardSelect` on staging v0.1.13 (each shard's own discovery); the catalogue is the one a release build
 *  bakes, `test/pins/catalogue.json`, whose placement statuses J313 sets. */
const ART = { thumb: '', portrait: '', landscape: '' };
const row = (slug: string, name: string, status: TitleManifest['status'], shardSelect?: false): TitleManifest =>
  ({ slug, name, biome: name, status, card: ART, ...(shardSelect === undefined ? {} : { shardSelect }) });
const ROWS: readonly TitleManifest[] = [
  row('driftwood-isle', 'Driftwood Isle', 'live'), row('pine-hollow', 'Pine Hollow', 'earlyAccess'),
  row('nalati-grasslands', 'Nalati Grasslands', 'earlyAccess'), row('nine-dragon-stack', 'Nine Dragon Stack', 'experimental'),
  row('brasscap-mesa', 'Brasscap Mesa', 'hidden'), row('proof-plain', 'Proof Plain', 'hidden', false),
  row('proof-valley', 'Proof Valley', 'hidden', false), row('open-plot-night-market', 'Open Plot · Night Market', 'experimental', false),
  row('open-plot-thin-ice', 'Open Plot · Thin Ice', 'earlyAccess', false), row('open-plot-desert-ruin', 'Open Plot · Desert Ruin', 'hidden', false),
  row('open-plot-coral-drift', 'Open Plot · Coral Drift', 'earlyAccess', false),
  row('sunscar-dunes', 'Signal Dunes', 'experimental'), row('far-reach', 'Sky Reach', 'experimental'), row('_proto', 'Prototype shard', 'hidden'),
];
const PLAYER: MenuMode = { developer: false, devserver: false };

const decks: TitleDeck[] = [];
beforeEach(() => { installCatalogue(catalogueBeforePlacements); });
afterEach(() => { for (const deck of decks.splice(0)) deck.dispose(); document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });
const deckOf = (showHidden: boolean, mode: MenuMode): TitleDeck => {
  installTitleManifests(ROWS);
  const deck = buildTitleDeck({ cards: titleCards(showHidden, () => null, () => null), active: null, onEnter: () => undefined,
    mode: () => mode });
  document.body.append(deck.root); decks.push(deck);
  return deck;
};
/** each card on the deck: its name, the tag over its picture, and whether ENTER WORLD enters it */
const view = (deck: TitleDeck): { name: string; tag: string; enters: boolean }[] => Array.from(deck.root.querySelectorAll('.ws-menu-card')).map((card) => ({
  name: card.querySelector('b')?.textContent ?? '',
  tag: card.querySelector('.ws-menu-card-exp')?.textContent ?? '',
  enters: card instanceof HTMLElement && card.dataset['enters'] === '1',
}));

test('J313: with Developer off, the three unlocked shards enter with their labels, no Template, open plot or Thin Ice card', () => {
  const cards = view(deckOf(false, PLAYER));
  expect(cards).toEqual([
    { name: 'Driftwood Isle', tag: '', enters: true },
    { name: 'Pine Hollow', tag: 'Early access', enters: true },
    { name: 'Nalati Grasslands', tag: 'Early access', enters: true },
    { name: 'Nine Dragon Stack', tag: 'Partial', enters: true },
    // QA 11-23-b row 3 (Jake, ~11:25 Cancún: "brasscap is not developer only"): the pinned placement is earlyAccess
    { name: 'Brasscap Mesa', tag: 'Early access', enters: true },
    { name: 'Signal Dunes', tag: 'Experimental', enters: true },
    { name: 'Sky Reach', tag: 'Experimental', enters: true },
  ]);
  expect(cards.some(({ tag }) => tag === 'Coming soon')).toBe(false);
  expect(cards.some(({ name }) => name.startsWith('Open Plot') || name === 'Thin Ice')).toBe(false);
  expect(decks[0]?.root.querySelector('.ws-menu-card-partial')?.textContent).toBe('Partial');
});

test('J313: ENTER ZONE (MS3, was ENTER WORLD) reads Enter zone, not Coming soon, on each unlocked card for a player', () => {
  const deck = deckOf(false, PLAYER);
  for (const slug of ['nine-dragon-stack', 'sunscar-dunes', 'far-reach']) {
    deck.select(deck.cards.findIndex((card) => card.slug === slug), false);
    expect(deck.root.querySelector('.ws-menu-play b')?.textContent).toBe('Enter zone');
  }
});

test('J313: Developer still sees the Thin Ice draft and the hidden shards; open plots stay off the deck', () => {
  const names = view(deckOf(true, { developer: true, devserver: false })).map(({ name }) => name);
  expect(names).toContain('Thin Ice');
  expect(names).toContain('Brasscap Mesa');
  expect(names.some((name) => name.startsWith('Open Plot'))).toBe(false);
});

test('SB46: the title summary counts an opened shard for a player, never the Template prototype', async () => {
  const { summaryView } = await import('../src/client/game/summary');
  const view = summaryView({ v: 1, shards: { _proto: { earned: 2, total: null, playS: 10, at: 0 }, 'far-reach': { earned: 3, total: null, playS: 10, at: 0 } } }, ROWS);
  expect(view.lines.map(({ slug }) => slug)).toContain('far-reach');
  expect(view.lines.some(({ slug }) => slug === '_proto')).toBe(false);
});

// FM4 9b/10b (meta MMO-FAILURE-MODES-PLAN; review of plan/mfm2): a world build's title gate may hold ENTER WORLD while it asks the world.
test('a gated ENTER WORLD stays busy while the gate asks, and enters the card tapped even if the deck moved meanwhile', async () => {
  installTitleManifests(ROWS);
  let release: () => void = () => undefined, enter: () => void = () => undefined;
  const entered: string[] = [];
  const deck = buildTitleDeck({ cards: titleCards(false, () => null, () => null), active: null, onEnter: (card) => { entered.push(card.slug); },
    mode: () => PLAYER,
    gate: (go) => new Promise<void>((resolve) => { enter = go; release = resolve; }) });
  document.body.append(deck.root); decks.push(deck);
  const play = deck.root.querySelector<HTMLButtonElement>('.ws-menu-play');
  deck.select(deck.cards.findIndex((card) => card.slug === 'pine-hollow'), false);
  play?.click();
  expect(play?.getAttribute('aria-busy')).toBe('true');
  deck.select(0, false);
  enter(); release();
  await Promise.resolve(); await Promise.resolve();
  expect(play?.getAttribute('aria-busy')).toBeNull();
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(entered).toEqual(['pine-hollow']);
});

/** STAGING-BUGBASH SB46 (Jake's pick on the zone sweep board, recommended): J313 opened the old `_` Template to players while
 *  that slug was Mossgate; Mossgate Hollow is `mossgate` now (SS-SHIPa), so a grey-box prototype is Developer only again. A `_`
 *  prototype stays off a player's deck even when a catalogue placement still says `live` (an API grid a pin refresh copies). */
test('SB46: a `_` prototype is Developer only, even when its catalogue placement says live', () => {
  const [first] = catalogueBeforePlacements.placements;
  if (first === undefined) throw new Error('The catalogue has placements');
  installCatalogue({ ...catalogueBeforePlacements, placements: [...catalogueBeforePlacements.placements,
    { ...first, instance: 'proto-solo', slug: '_proto', cell: [5, 9], status: 'live' }] });
  expect(view(deckOf(false, PLAYER)).map(({ name }) => name)).not.toContain('Prototype shard');
  expect(view(deckOf(true, { developer: true, devserver: false })).map(({ name }) => name)).toContain('Prototype shard');
});
