// @vitest-environment happy-dom
// STAGING-BUGBASH (meta docs/plans/STAGING-BUGBASH-PLAN.md, opus-bugfix2): the Shard Select bugs Jake's 12:49 phone shot and the
// 2026-11-16 staging bash found on v0.1.30, each read off the deck staging drew.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleDeck, titleCards, type TitleDeck } from '../src/client/game/titleDeck';
import { catalogueCards } from '../src/client/game/grid/placedCards';
import { readGridEdges } from '../src/client/game/grid/edgeSources';
import { compactBuildLabel } from '../src/client/engine/ui/buildCheck';
import type { MenuMode } from '../src/client/game/grid/menu';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';
import { installShards } from '../src/client/game/shard/list';

const ART = { thumb: '', portrait: '', landscape: '' };
const row = (slug: string, name: string, biome: string, status: TitleManifest['status'], shardSelect?: false): TitleManifest =>
  ({ slug, name, biome, status, card: ART, ...(shardSelect === undefined ? {} : { shardSelect }) });
/** Release rows with Thin Ice added to the grid by the API's signed placement file. */
const ROWS: readonly TitleManifest[] = [
  row('driftwood-isle', 'Driftwood Isle', 'Low-poly island, open ocean', 'live'),
  row('open-plot-thin-ice', 'Open Plot · Thin Ice', 'Open plot · coming soon', 'earlyAccess', false),
];
const DEVELOPER: MenuMode = { developer: true, devserver: false };
const PLAYER: MenuMode = { developer: false, devserver: false };

const decks: TitleDeck[] = [];
beforeEach(() => { installCatalogue({ ...catalogueBeforePlacements, placed: ['open-plot-thin-ice'] }); installTitleManifests(ROWS); });
afterEach(() => { for (const deck of decks.splice(0)) deck.dispose(); document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });
const deckOf = (mode: MenuMode): TitleDeck => {
  const deck = buildTitleDeck({ cards: titleCards(mode.developer, () => null, () => null, () => true), active: null, onEnter: () => undefined,
    mode: () => mode });
  document.body.append(deck.root); decks.push(deck);
  return deck;
};
const cardsOf = (deck: TitleDeck): { name: string; sub: string; ribbon: string; tags: string[]; enters: boolean }[] => Array.from(deck.root.querySelectorAll<HTMLElement>('.ws-menu-card')).map((card) => ({
  name: card.querySelector('b')?.textContent ?? '', sub: card.querySelector('small')?.textContent ?? '',
  ribbon: card.querySelector('.ws-menu-card-exp')?.textContent ?? '',
  tags: Array.from(card.querySelectorAll('.ws-menu-card-tag')).map((tag) => tag.textContent ?? ''),
  enters: card.dataset['enters'] === '1',
}));

test('QA 11-19 #12: a placed open plot stays off the player deck and has one enterable Developer card', () => {
  expect(cardsOf(deckOf(PLAYER)).map(({ name }) => name)).toEqual(['Driftwood Isle']);
  const thin = cardsOf(deckOf(DEVELOPER)).filter(({ name }) => /thin ice/iu.test(name));
  expect(thin).toEqual([
    { name: 'Open Plot · Thin Ice', sub: 'Open plot', ribbon: 'Early access', tags: [], enters: true },
  ]);
});

test('SB11: with no Thin Ice shard carded, Developer still sees the Thin Ice draft', () => {
  installCatalogue(catalogueBeforePlacements);
  expect(cardsOf(deckOf(DEVELOPER)).map(({ name }) => name)).toContain('Thin Ice');
});

test('SB17: no card wears a LOAD or LOADED badge; the card still says whether ENTER WORLD enters it', () => {
  const deck = buildTitleDeck({ cards: titleCards(false, () => null, () => null, () => true), active: 'driftwood-isle', onEnter: () => undefined,
    mode: () => PLAYER });
  document.body.append(deck.root); decks.push(deck);
  const cards = cardsOf(deck);
  expect(cards.flatMap(({ tags }) => tags)).toEqual([]);
  expect(cards.map(({ enters }) => enters)).toEqual([true]);
});

test('SB12: an upload whose catalogue name is only its slug is a test placement: a readable name, Developer only', async () => {
  const fetch: typeof globalThis.fetch = (input) => Promise.resolve(new Response(JSON.stringify(String(input instanceof Request ? input.url : input).endsWith('/mu9-auto-20261116')
    ? { slug: 'mu9-auto-20261116', name: 'mu9-auto-20261116' } : { slug: 'glass-orchard', name: 'Glass Orchard' })));
  const rows = await catalogueCards(['mu9-auto-20261116', 'glass-orchard'], { fetch, api: 'https://api.test', signal: new AbortController().signal, order: 9 });
  expect(rows.map(({ slug, name, status }) => ({ slug, name, status }))).toEqual([
    { slug: 'mu9-auto-20261116', name: 'Mu9 Auto 20261116', status: 'hidden' },
    { slug: 'glass-orchard', name: 'Glass Orchard', status: 'live' },
  ]);
});

test('SS14e: a one-word name that is its slug capitalised (Glowfen) is a real name, not a test placement', async () => {
  const names: Record<string, string> = { glowfen: 'Glowfen', 'mu9-auto-20261116': 'mu9-auto-20261116', 'MU9-loud': 'MU9-loud' };
  const fetch: typeof globalThis.fetch = (input) => {
    const slug = decodeURIComponent(String(input instanceof Request ? input.url : input).split('/').pop() ?? '');
    return Promise.resolve(new Response(JSON.stringify({ slug, name: names[slug] })));
  };
  const rows = await catalogueCards(Object.keys(names), { fetch, api: 'https://api.test', signal: new AbortController().signal, order: 1 });
  expect(rows.map(({ slug, status }) => ({ slug, status }))).toEqual([
    { slug: 'glowfen', status: 'live' }, { slug: 'mu9-auto-20261116', status: 'hidden' }, { slug: 'MU9-loud', status: 'hidden' },
  ]);
});

test('SB12: a grid cell whose shard this page has no data for keeps road-level edges without asking for a terrain bake', async () => {
  installShards([]);
  const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
  const edges = await readGridEdges({ instance: 'mu9-auto-20261116', slug: 'mu9-auto-20261116', cell: [1, 3], origin: { x: 0, y: 0, z: 0 } }, { fetch });
  expect(edges.kind).toBe('declared');
  if (edges.kind === 'declared') expect([edges.observations.north.entryWidth, Math.max(...edges.profiles.east.heights)]).toEqual([0, 0]);
  expect(fetch).not.toHaveBeenCalled();
});

test('SB15: a phone pill shows the short describe, which fits beside SHARD SELECT', () => {
  expect(compactBuildLabel('v0.1.28-96-gf8ff9bd9')).toBe('v0.1.28+96');
  expect(compactBuildLabel('v0.1.28-96-gf8ff9bd9-dirty')).toBe('v0.1.28+96');
  expect(compactBuildLabel('v0.1.31')).toBe('v0.1.31');
  expect(compactBuildLabel('v0.1.5 · a8144a5')).toBe('v0.1.5 · a8144a5');
});
