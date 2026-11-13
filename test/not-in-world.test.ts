// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- the catalogue pin and the entry's wiring are read where the page applies them.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleDeck, titleCards, type TitleDeck } from '../src/client/game/titleDeck';
import { enterByShard, inThisWorld, worldHosted, worldOpens, type RouteMemory } from '../src/client/game/grid/oneWayIn';
import { pageGridIntents } from '../src/client/game/grid/intent';
import { GAME_STRINGS } from '../src/shared/game/strings';
import type { MenuMode } from '../src/client/game/grid/menu';

// OFFLINE OF3 (J298, J300): on a world build, a shard the world doesn't open is never entered. A card whose shard the kept world word
// leaves out, or that the catalogue doesn't place, reads "Not in this world yet" with ENTER WORLD off; a `?chunk=` link to it lands on
// the title with that line. This replaces ba88ac9a's "unplaced plays solo". Prod's two-shard word is the fixture (the plan keeps it).
const WORLD = { release: 'https://packs.example/releases/prod.json', key: 'ab' };
const PROD_WORD = ['driftwood-isle', 'nalati-grasslands'];
const silent = (): Promise<null> => new Promise<never>(() => { /* a link that never answers */ });
type Kept = { grid: boolean; shards: readonly string[] | null };
function memory(start: Record<string, Kept> = {}): RouteMemory & { readonly kept: Record<string, Kept> } {
  const kept = { ...start };
  return { kept, read: release => kept[release]?.grid ?? null, shards: release => kept[release]?.shards ?? null,
    write: (release, grid, shards = null) => { kept[release] = { grid, shards }; } };
}
const ART = { thumb: '', portrait: '', landscape: '' };
const row = (slug: string, name: string, status: TitleManifest['status']): TitleManifest => ({ slug, name, biome: name, status, card: ART });
const ROWS: readonly TitleManifest[] = [
  row('driftwood-isle', 'Driftwood Isle', 'live'), row('pine-hollow', 'Pine Hollow', 'earlyAccess'),
  row('nalati-grasslands', 'Nalati Grasslands', 'earlyAccess'), row('blender-template', 'Brasscap Mesa', 'hidden'),
  row('_template', 'Template shard', 'hidden'), row('open-plot-thin-ice', 'Open Plot · Thin Ice', 'earlyAccess'),
];
const DEVELOPER: MenuMode = { developer: true, devserver: false };
const decks: TitleDeck[] = [];
beforeEach(() => { installCatalogue(JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8'))); installTitleManifests(ROWS); });
afterEach(() => {
  for (const deck of decks.splice(0)) deck.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); pageGridIntents().consume('');
});
const deckOf = (opens: (slug: string) => boolean): TitleDeck => {
  const deck = buildTitleDeck({ cards: titleCards(true, () => null, () => null, opens), active: null, onEnter: () => undefined,
    onExplore: () => undefined, onSettings: () => undefined, mode: () => DEVELOPER });
  document.body.append(deck.root); decks.push(deck);
  return deck;
};
const view = (deck: TitleDeck): Record<string, string> => Object.fromEntries(Array.from(deck.root.querySelectorAll('.ws-menu-card')).map(card =>
  [card.querySelector('b')?.textContent ?? '', card.querySelector('small')?.textContent ?? '']));

test('the card rule: the catalogue must place the shard, and a word (heard or kept) that names shards must name it', () => {
  expect(inThisWorld('open-plot-thin-ice', null), 'Thin Ice: the grid does not place it (J305), word or no word').toBe(false);
  expect(inThisWorld('open-plot-thin-ice', ['open-plot-thin-ice']), 'even a word naming it: there is no cell to seat it in').toBe(false);
  expect([inThisWorld('blender-template', PROD_WORD), inThisWorld('_template', PROD_WORD)], 'Brasscap and Template are placed, but prod\'s word leaves them out').toEqual([false, false]);
  expect([inThisWorld('blender-template', null), inThisWorld('_template', null)], 'no word, nothing kept: a placed shard enters (J300)').toEqual([true, true]);
  expect([inThisWorld('driftwood-isle', PROD_WORD), inThisWorld('nalati-grasslands', PROD_WORD)]).toEqual([true, true]);
  expect(worldOpens(undefined, memory())('open-plot-thin-ice'), 'a build with no world (preview) opens every card').toBe(true);
});

test('with the word missing, the kept answer decides; with it present, the word heard now does and is kept', async () => {
  const kept = memory({ [WORLD.release]: { grid: true, shards: PROD_WORD } });
  // missing: the door never answers, so the device's kept word (prod's two shards) decides
  expect(await worldHosted(WORLD, 10, kept, silent)).toBe(true);
  const missing = worldOpens(WORLD, kept);
  expect(['driftwood-isle', 'nalati-grasslands', 'pine-hollow', '_template', 'blender-template'].map(missing)).toEqual([true, true, false, false, false]);
  // present: a word that opens the whole grid replaces the kept one, and is kept for the next launch
  expect(await worldHosted(WORLD, 1000, kept, async () => ({ grid: true, shards: [...PROD_WORD, 'pine-hollow', '_template'] }))).toBe(true);
  const present = worldOpens(WORLD, kept);
  expect(['pine-hollow', '_template', 'blender-template'].map(present)).toEqual([true, true, false]);
  expect(kept.kept[WORLD.release]?.shards).toContain('pine-hollow');
  // nothing kept and no word: only the catalogue rule
  expect(['pine-hollow', '_template', 'blender-template', 'open-plot-thin-ice'].map(worldOpens(WORLD, memory()))).toEqual([true, true, true, false]);
});

test('Developer on, prod\'s kept word: Brasscap and Template read "Not in this world yet" and ENTER WORLD is off; Driftwood enters', () => {
  const deck = deckOf(worldOpens(WORLD, memory({ [WORLD.release]: { grid: true, shards: PROD_WORD } })));
  const cards = view(deck), line = GAME_STRINGS.notInWorld.badge;
  expect([cards['Brasscap Mesa'], cards['Template shard'], cards['Pine Hollow']]).toEqual([line, line, line]);
  expect(cards['Driftwood Isle']).toBe('Driftwood Isle');
  const play = deck.root.querySelector<HTMLButtonElement>('.ws-menu-play'), explore = deck.root.querySelector<HTMLButtonElement>('.ws-menu-explore');
  for (const name of ['Brasscap Mesa', 'Template shard']) {
    deck.select(deck.cards.findIndex(card => card.name === name));
    expect([play?.disabled, explore?.disabled, play?.querySelector('b')?.textContent], name).toEqual([true, true, line]);
    expect(deck.activate(), `${name} does not load`).toBeNull();
  }
  deck.select(0);
  expect(play?.disabled).toBe(false);
});

test('no kept word: every placed card enters (J300); only a shard the grid does not place is closed', () => {
  const cards = view(deckOf(worldOpens(WORLD, memory())));
  expect(cards['Open Plot · Thin Ice']).toBe(GAME_STRINGS.notInWorld.badge);
  expect([cards['Brasscap Mesa'], cards['Template shard'], cards['Pine Hollow']]).toEqual(['Brasscap Mesa', 'Template shard', 'Pine Hollow']);
  expect(view(deckOf(worldOpens(undefined)))['Open Plot · Thin Ice'], 'preview: no world, no closed card').toBe('Open Plot · Thin Ice');
});

test('a ?chunk= page of a shard the world leaves out never takes a grid entry, and the entry lands on the title with the line', async () => {
  const kept = memory();
  const cell = await enterByShard({ online: true, slug: 'pine-hollow', kept: false }, WORLD, world => worldHosted(world, 1000, kept, async () => ({ grid: true, shards: PROD_WORD })), slug => worldOpens(WORLD, kept)(slug));
  expect(cell, 'prod\'s word leaves Pine out: no grid entry at its cell').toBeNull();
  expect(pageGridIntents().pending('pine-hollow')).toBe(false);
  expect(await enterByShard({ online: true, slug: 'driftwood-isle', kept: false }, WORLD, async () => true, slug => worldOpens(WORLD, kept)(slug))).toBe('driftwood-isle');
  // prod's real word is one cell: the one way in keeps a one-shard page and admits nothing; the kept word then closes Pine for the entry
  const oneCell = memory();
  expect(await enterByShard({ online: true, slug: 'pine-hollow', kept: false }, WORLD, world => worldHosted(world, 1000, oneCell, async () => ({ grid: false, shards: PROD_WORD })), slug => worldOpens(WORLD, oneCell)(slug))).toBeNull();
  expect([pageGridIntents().pending('pine-hollow'), worldOpens(WORLD, oneCell)('pine-hollow'), worldOpens(WORLD, oneCell)('driftwood-isle')]).toEqual([false, false, true]);
  const entry = readFileSync('src/client/app/entry.ts', 'utf8');
  expect(entry, 'the page that leaves drops any grid entry it held').toMatch(/const \{ dropGridEntry, notInWorldLine \} = [^\n]*\n\s+dropGridEntry\(slug\);/u);
  expect(entry, 'after the one way in, a world build checks the shard is in this world, else the title with the line')
    .toMatch(/enterByShard\(\{ online, slug: requested, [^\n]*\n[^\n]*\n\s+if \(await notInWorld\(\)\) return notInWorldTitle\(requested\);/u);
  expect(entry, 'and before the title-first rule, by the kept word, so a bare link says why')
    .toMatch(/if \(requested !== null && await notInWorld\(\)\) return notInWorldTitle\(requested\);\n\s+const tapped = /u);
  expect(entry).toMatch(/online && requested !== null && [^\n]*\n\s+&& !\(await [^\n]*\)\)\.worldOpens\(world\)\(requested\);/u);
  expect(entry).toMatch(/return showPageTitle\(notInWorldLine\(findTitleManifest\(slug\)\?\.name \?\? slug\)\);/u);
});

test('a word that answers after the deadline is kept for the next launch only: this page enters as J300 says', async () => {
  const kept = memory();
  let answer: (word: { grid: boolean; shards: readonly string[] }) => void = () => undefined;
  const slow = (): Promise<{ grid: boolean; shards: readonly string[] }> => new Promise(resolve => { answer = resolve; });
  expect(await worldHosted(WORLD, 10, kept, slow), 'no word in time, nothing kept: the grid').toBe(true);
  expect(worldOpens(WORLD, kept)('pine-hollow'), 'this page: nothing kept yet, Pine is open').toBe(true);
  answer({ grid: true, shards: PROD_WORD }); await Promise.resolve(); await Promise.resolve();
  expect(worldOpens(WORLD, kept)('pine-hollow'), 'the next launch: the late word closes Pine').toBe(false);
});
