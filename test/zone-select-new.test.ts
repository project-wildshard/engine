// @vitest-environment happy-dom
// ZONE-SELECT-SERVED ZS11 (J461: "every time you upload a zone to the API server, it's going to become available new"): an upload
// the API auto-placed after the build, so the build has no row for it, reaches Zone Select's NEW through the placement file's path
// (SA46 cards it from its catalogue entry, HG4 dresses it in its cooked hero) and ENTER ZONE takes it to its cell. The page's room
// list names it in NEW; the tab orders the build's cards and the placed ones alike. HG4 stands: an upload with no hero is Developer
// only, in NEW too (Jake, 2026-11-17: "in zone select there are zones without hero images that's bad").
// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the API does.
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { learnPlacedCells, type PlacedKeep } from '../src/client/game/grid/placedCells';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { buildTitleMenu } from '../src/client/game/mainMenu';
import { oneWayIn } from '../src/client/game/grid/oneWayIn';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { markNameAsked } from '../src/client/engine/ui/namePrompt';
import type { PlacedContent } from '../src/client/game/grid/placedContent';
import type { TitleCard } from '../src/client/game/titleDeck';
import type { ZoneSelectCard, ZoneSelectDocument } from '../src/shared/game/grid/zoneSelectRows';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';

const key = generateKeyPairSync('ed25519');
const PUBLIC = key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const URL_AT = 'https://packs.example/releases/staging-placements.json';
const API = 'https://api.example';
const SLUG = 'new-author-shard';
const CELLS = [{ instance: SLUG, slug: SLUG, cell: [1, 3] as const }];
const body = JSON.stringify({ kind: 'placement', channel: 'staging', serial: 1, cells: CELLS });
const FILE = JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.privateKey).toString('hex') });
const ENTRY = { slug: SLUG, name: 'Glass Orchard', heroHash: null, live: { revision: 1, hash: 'ab' } };
const HERO = { thumb: 'https://packs.example/loose/x/t.jpg', portrait: 'https://packs.example/loose/x/p.jpg', landscape: 'https://packs.example/loose/x/l.jpg' };
const CONTENT: PlacedContent = { spawn: { slug: SLUG, entry: {}, whole: {}, base: 'https://packs.example/', loose: 'https://packs.example/loose/x/', programs: false }, verdict: null, card: HERO };
const ART = { thumb: '/t.jpg', portrait: '/p.jpg', landscape: '/l.jpg' };
const ROWS: readonly TitleManifest[] = [
  { slug: 'driftwood-isle', name: 'Driftwood Isle', biome: 'Low-poly island', status: 'live', card: ART },
  { slug: 'pine-hollow', name: 'Pine Hollow', biome: 'Boreal pine forest', status: 'live', card: ART },
];
// the placement file and the new slug's catalogue entry; everything else is a 404
const fetchPort = ((url: string | URL | Request): Promise<Response> => {
  const at = url instanceof Request ? url.url : String(url);
  if (at === URL_AT) return Promise.resolve(new Response(FILE));
  if (at === `${API}/api/catalogue/shards/${SLUG}`) return Promise.resolve(Response.json(ENTRY));
  return Promise.resolve(new Response('', { status: 404 }));
}) as typeof fetch;
const keep = (): PlacedKeep => { const kept = new Map<string, string>(); return { read: url => kept.get(url) ?? null, write: (url, text) => { if (text === null) kept.delete(url); else kept.set(url, text); } }; };
const zone = (slug: string): ZoneSelectCard => ({ slug, name: slug, status: null, heroHash: null, firstUploadedAt: '2026-11-19T20:00:00.000Z', enters: 0 });
const SERVED: ZoneSelectDocument = { channel: 'staging', serial: 2, featured: [zone('driftwood-isle')], popular: [zone('pine-hollow')], new: [zone(SLUG), zone('pine-hollow')], all: [] };
const player = { developer: false, devserver: false };
const tap = (el: Element | null): void => {
  if (el === null) throw new Error('missing tap target');
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const frames = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 120); });
const disposers: (() => void)[] = [];
beforeEach(() => { installCatalogue(catalogueBeforePlacements); installTitleManifests(ROWS); markNameAsked(); });
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });

const newTab = (content: () => Promise<PlacedContent>) => async (): Promise<{ readonly view: ReturnType<typeof buildTitleMenu>; readonly onEnter: ReturnType<typeof vi.fn<(card: TitleCard) => void>> }> => {
  const read = await learnPlacedCells(URL_AT, { keep: keep(), fetch: fetchPort, publicKey: PUBLIC, api: API, content });
  expect(read).toMatchObject({ added: CELLS, carded: [SLUG] });
  const onEnter = vi.fn<(card: TitleCard) => void>();
  const view = buildTitleMenu({ zoneSelect: SERVED, active: null, onEnter, onSettings: () => undefined, onGrid: () => undefined, mode: () => player, screen: 'select' });
  document.body.append(view.root); disposers.push(() => { view.dispose(); });
  tap(view.root.querySelector('.ws-menu-tab[data-tab="new"]'));
  return { view, onEnter };
};

test('ZS11: a fresh upload the build has no row for shows first in NEW in its cooked hero, and ENTER ZONE takes it to its cell', async () => {
  const { view, onEnter } = await newTab(() => Promise.resolve(CONTENT))();
  expect(view.cards.map(card => card.slug)).toEqual([SLUG, 'pine-hollow']);
  expect(view.root.querySelector('.ws-menu-card.selected b')?.textContent).toBe('Glass Orchard');
  expect(view.cards[0]?.heroPortrait).toBe(HERO.portrait);
  expect(view.root.querySelector<HTMLElement>('.ws-menu-dots i[data-i="0"]')?.style.getPropertyValue('--thumb')).toContain(HERO.thumb);
  expect(view.root.querySelector<HTMLButtonElement>('.ws-menu-play')?.disabled).toBe(false);
  tap(view.root.querySelector('.ws-menu-play'));
  await frames();
  expect(onEnter.mock.calls.map(([card]) => card.slug)).toEqual([SLUG]);
  // the page it travels to (a bare `/`, the tap naming the zone) enters the grid at the cell the placement file gave it
  expect(oneWayIn({ online: true, hosted: true, slug: SLUG, kept: false }, new GridAssembly(player))).toMatchObject({ instance: SLUG, cell: [1, 3] });
});

test('ZS11: an upload with no hero stays off a player\'s NEW (HG4); the tab still shows the rest', async () => {
  const { card: _hero, ...heroless } = CONTENT;
  const { view } = await newTab(() => Promise.resolve(heroless))();
  expect(view.cards.map(card => card.slug)).toEqual(['pine-hollow']);
});
