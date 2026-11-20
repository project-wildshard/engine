/**
 * pause ▸ Settings ▸ SAVES and its New game sheet (SHARD-PLATFORM SF33b; Jake's pick G83, E439:
 * `art/settings/round-2-new-game/C-*`). A card per shard save (each template copy its own, G67; one progress across
 * Select a shard and the grid, G69) with the shard's picker thumbnail; NEW GAME opens a bottom sheet with the
 * before → after from `previewNewGame` and what is kept; its NEW GAME runs `resetNewGame` and reloads only when the
 * reset applied, KEEP PLAYING closes it. Styled by `src/client/game/saves.css` (prefix `ws-saves-`).
 */
import './saves.css';
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { exitSessionToTitle } from './session/exitToTitle';
import { appIdentity } from '@wildshard/engine/app/identity';
import { markReload } from '@wildshard/engine/boot/lastEnd';
import { isDev } from '@wildshard/engine/core/devMode';
import { playerHidden } from '../../shared/game/grid/catalogueSlot';
import { forgetServerInstance, openIndexedSaves, serverSaveDatabase } from '@wildshard/engine/saves/indexed';
import { SaveStore, type SaveStorage } from '@wildshard/engine/saves/store';
import type { GameMenu } from '@wildshard/engine/ui/Menu';
import { mountUi } from '@wildshard/engine/ui/ownership';
import { catalogueDocument } from '../../shared/game/grid/catalogueDocument';
import { previewNewGame, resetNewGame, roomPreview, type NewGameProgress, type NewGameSummary } from '../../shared/game/newGame';
import type { LocalSaveInstance } from '../../shared/game/instanceSaves';
import { catalogueManifests } from './shard/titleList';
import { wirePage } from './shardfile/wirePage';
import type { ShardManifest } from './shard/manifest';

/** Every string the section and the sheet show, quoted from the G83 board. */
export const SAVES_STRINGS = {
  title: 'SAVES',
  here: 'HERE',
  newGame: 'NEW GAME',
  keepPlaying: 'KEEP PLAYING',
  sheetTitle: (name: string): string => `NEW GAME · ${name.toUpperCase()}`,
  quests: 'QUESTS', inventory: 'INVENTORY', flags: 'FLAGS',
  questsLine: (value: string): string => `QUESTS ${value}`,
  questCount: (completed: number, total: number | null): string => total === null ? `${completed} DONE` : `${completed} / ${total}`,
  questsUnknown: 'STARTED',
  items: (n: number): string => `${n} ${n === 1 ? 'ITEM' : 'ITEMS'}`,
  coins: (n: number): string => `${n} ${n === 1 ? 'COIN' : 'COINS'}`,
  empty: 'EMPTY',
  reset: 'RESET',
  none: 'NONE',
  arrow: (before: string, after: string): string => `${before} → ${after}`,
  kept: 'KEPT: PROFILE, FEATS, OTHER SHARDS',
  copy: (name: string, ordinal: string): string => `${name} · COPY ${ordinal}`,
  unreadable: 'SAVE UNREADABLE',
  refused: 'Could not start a new game: your save is unchanged.',
} as const;

/** One save the section can show: a stable instance, its name and its picker art. */
export interface SaveCardSpec { instance: LocalSaveInstance; name: string; thumb: string; listed: boolean }

const quests = (p: NewGameProgress, total: number | null): string =>
  p.quests.completed === null ? SAVES_STRINGS.questsUnknown : SAVES_STRINGS.questCount(p.quests.completed, total);
const inventory = (p: NewGameProgress): string => {
  const { quantity, coins } = p.inventory;
  if (quantity === 0 && coins === 0) return SAVES_STRINGS.empty;
  return [quantity > 0 ? SAVES_STRINGS.items(quantity) : '', coins > 0 ? SAVES_STRINGS.coins(coins) : ''].filter((s) => s !== '').join(' · ');
};
/** A card's two lines ("QUESTS 2 / 5", "12 ITEMS" / "EMPTY"). `total` is the shard's quest count when it is declared. */
export function cardLines(summary: NewGameSummary, total: number | null = null): [string, string] {
  return [SAVES_STRINGS.questsLine(quests(summary.before, total)), inventory(summary.before)];
}
/** The sheet's before → after rows: quests, inventory, flags. */
export function sheetRows(summary: NewGameSummary, total: number | null = null): { label: string; value: string }[] {
  return [
    { label: SAVES_STRINGS.quests, value: SAVES_STRINGS.arrow(quests(summary.before, total), quests(summary.after, total)) },
    { label: SAVES_STRINGS.inventory, value: SAVES_STRINGS.arrow(inventory(summary.before), inventory(summary.after)) },
    { label: SAVES_STRINGS.flags, value: summary.before.flags.length > 0 ? SAVES_STRINGS.reset : SAVES_STRINGS.none },
  ];
}
/** Something worth a card even when its shard is not listed: progress, a pack or a purse. */
const hasSave = (s: NewGameSummary): boolean => s.before.quests.saved || s.before.inventory.quantity > 0 || s.before.inventory.coins > 0 || s.removedKeys.length > 0;

/** Every stable save instance the singleplayer catalogue places (the canonical copies, then the grid's template copies). */
type CardManifest = Pick<ShardManifest, 'slug' | 'name' | 'status' | 'card'> & {readonly order?:number};
export function saveCards(list: readonly CardManifest[], developer: boolean): SaveCardSpec[] {
  const bare = (slug: string): string => slug.replace(/^_/u, '');
  const bySlug = new Map(list.map((m) => [bare(m.slug), m]));
  const listed = (m: CardManifest): boolean => developer || !playerHidden(m); // J313: the catalogue can open a hidden shard
  const seen = new Set<string>(), out: SaveCardSpec[] = [];
  const add = (instance: string, slug: string, copy: string | null): void => {
    const m = bySlug.get(bare(slug));
    if (m === undefined || seen.has(instance)) return;
    seen.add(instance);
    out.push({ instance: { id: instance, shard: m.slug }, name: copy === null ? m.name : SAVES_STRINGS.copy(m.name, copy), thumb: m.card.thumb, listed: listed(m) && copy === null });
  };
  const catalogue = catalogueDocument();
  for (const p of [...catalogue.placements].sort((a, b) => (bySlug.get(bare(a.slug))?.order ?? 0) - (bySlug.get(bare(b.slug))?.order ?? 0))) add(p.instance, p.slug, null);
  for (const c of catalogue.grid.cells) add(c.instance, c.slug, /^template-(\d+)$/u.exec(c.instance)?.[1] ?? null);
  return out;
}

export interface SavesSettingsOptions {
  /** the save the player stands in now (the grid's current cell, else this shard's canonical copy) */
  here: () => LocalSaveInstance | null;
  /** true when other instances may be live on this page (the grid's residents): every applied reset reloads */
  grid: boolean;
  /** Capture location before resetting; returned callback runs only after success, before reload. */
  beforeReset?: (instance: LocalSaveInstance) => (() => void);
  /** Standalone reset leaves for the fresh title; absent a host port, the same navigation is used. */
  toTitle?: () => void;
  scope: Scope;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (text !== '') e.textContent = text; return e;
};

const preview = (instance: LocalSaveInstance): NewGameSummary | null => { try { return previewNewGame(app.saves, instance); } catch { return null; } };
const reset = (instance: LocalSaveInstance): boolean => { try { return resetNewGame(app.saves, instance).applied; } catch { return false; } };

/** A store's documents, read and never written: inspecting a save must not touch the running server's copy. */
const readOnly = (storage: SaveStorage): SaveStorage => ({ get length() { return storage.length; }, key: index => storage.key(index),
  getItem: key => storage.getItem(key), setItem: () => undefined, removeItem: () => undefined });
/** J130: what the server's copy of each save holds. A page on a server (every grid cell) keeps its progress there, and the
 *  page's own copy stays empty, so the cards read "QUESTS 0 DONE · EMPTY" mid-quest (meta QA-FEEDBACK-2026-11-20-mini row 5). */
async function serverPreviews(instances: readonly LocalSaveInstance[]): Promise<Map<string, NewGameSummary>> {
  // row 9: an online page's server is the room, which keeps this player's copy itself: the room says what it holds
  const room = await wirePage.roomSaves?.read([...new Set(instances.map((instance) => instance.shard))]).catch(() => null);
  if (room !== undefined && room !== null) {
    const found = new Map<string, NewGameSummary>();
    for (const instance of instances) { const save = room[instance.shard]; if (save !== undefined && save !== null) found.set(instance.id, roomPreview(instance, save)); }
    return found;
  }
  const saves = await openIndexedSaves(serverSaveDatabase()), out = new Map<string, NewGameSummary>();
  try {
    const store = new SaveStore({ local: readOnly(saves.storage), session: readOnly(saves.storage) });
    for (const instance of instances) { try { out.set(instance.id, previewNewGame(store, instance)); } catch { /* that copy is unreadable: the page's stands */ } }
  } finally { saves.close?.(); }
  return out;
}
/** The save a card shows: the server's copy when it holds anything (a reset clears both), else the page's own. */
export function mergedSummary(page: NewGameSummary | null, server: NewGameSummary | undefined): NewGameSummary | null {
  if (server === undefined || !hasSave(server)) return page;
  if (page === null || !hasSave(page)) return server;
  return { ...server, removedKeys: [...new Set([...server.removedKeys, ...page.removedKeys])].sort() };
}

/** J130: a page on a server has a second copy, and the server would reopen it. Stop the server first: it saves as a page hides. */
async function resetServerCopy(instance: LocalSaveInstance): Promise<void> {
  wirePage.stop();
  const saves = await openIndexedSaves(serverSaveDatabase()), { savePrefix } = appIdentity();
  resetNewGame(new SaveStore({ local: saves.storage, session: saves.storage }), instance);
  await saves.write(`${savePrefix}${instance.id}`, saves.storage.getItem(`${savePrefix}${instance.id}`)); // answers when that reset is durable
  await forgetServerInstance(saves, savePrefix, instance.id);
}

/** The New game sheet over the menu: before → after (the card's merged summary), what is kept, NEW GAME / KEEP PLAYING. */
function openSheet(card: SaveCardSpec, summary: NewGameSummary, opts: SavesSettingsOptions): void {
  const scope = opts.scope.child('saves.sheet');
  const root = el('div', 'ws-saves-sheet');
  const panel = el('div', 'ws-saves-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', SAVES_STRINGS.sheetTitle(card.name));
  panel.dataset['instance'] = card.instance.id;
  for (const corner of ['tl', 'tr', 'bl', 'br']) panel.append(el('i', `ws-saves-cb ${corner}`));
  const table = el('div', 'ws-saves-table');
  for (const row of sheetRows(summary)) {
    const r = el('div', 'ws-saves-row'); r.append(el('span', 'ws-saves-rowlab', row.label), el('span', 'ws-saves-rowval', row.value)); table.append(r);
  }
  const status = el('div', 'ws-saves-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const confirm = el('button', 'ws-saves-btn confirm', SAVES_STRINGS.newGame); confirm.type = 'button';
  const keep = el('button', 'ws-saves-btn keep', SAVES_STRINGS.keepPlaying); keep.type = 'button';
  panel.append(el('div', 'ws-saves-title', SAVES_STRINGS.sheetTitle(card.name)), table, el('div', 'ws-saves-kept', SAVES_STRINGS.kept), status, confirm, keep);
  root.append(panel);
  const close = (): void => { scope.dispose(); root.remove(); };
  mountUi(root, scope, document.body);
  const layer = app.ui.push('modal', { root, back: close }, scope);
  for (const action of ['pause', 'back'] as const) app.input.bind(action, close, scope, () => layer.top);
  scope.listen(root, 'pointerdown', (e) => { if (e.target === root) close(); });
  scope.listen(keep, 'click', close);
  scope.listen(confirm, 'click', () => {
    confirm.disabled = true;
    // QA-FEEDBACK-2026-11-20-mini row 9: an online page's save is the room's. The room resets it first (it lets the body go and forgets
    // the save before this player is seated again); a refusal leaves everything as it was, and play goes on
    const room = wirePage.roomSaves;
    if (room !== null) {
      void room.reset(card.instance.shard).then((taken) => {
        if (!taken) { status.textContent = SAVES_STRINGS.refused; status.hidden = false; confirm.disabled = false; return false; }
        let afterRoom: (() => void) | undefined;
        try { afterRoom = opts.beforeReset?.(card.instance); } catch { /* the room's copy is gone either way: the page goes on to reload */ }
        reset(card.instance);
        const leave = (): void => {
          if (!opts.grid) { (opts.toTitle ?? exitSessionToTitle)(); return; }
          afterRoom?.(); markReload('new game', 'new-game'); location.reload();
        };
        void resetServerCopy(card.instance).then(leave, leave);
        return true;
      }, () => { status.textContent = SAVES_STRINGS.refused; status.hidden = false; confirm.disabled = false; });
      return;
    }
    // a refusal leaves the disk and every live binding as they were: keep playing
    let afterReset: (() => void) | undefined;
    try { afterReset = opts.beforeReset?.(card.instance); }
    catch { status.textContent = SAVES_STRINGS.refused; status.hidden = false; confirm.disabled = false; return; }
    if (!reset(card.instance)) { status.textContent = SAVES_STRINGS.refused; status.hidden = false; confirm.disabled = false; return; }
    // MF10: no live standalone bindings survive any applied reset. The grid
    // retains its own recovery checkpoint and fresh-document reload.
    const leave = (): void => {
      if (!opts.grid) { (opts.toTitle ?? exitSessionToTitle)(); return; }
      afterReset?.(); markReload('new game', 'new-game'); location.reload();
    };

    void resetServerCopy(card.instance).then(leave, leave);
  });
  scope.raf(() => { root.classList.add('show'); });
}

/** Adds pause ▸ Settings ▸ SAVES to this level's menu (G83). */
export function installSavesSettings(menu: GameMenu, opts: SavesSettingsOptions): void {
  const label = el('div', 'ws-gmenu-label', SAVES_STRINGS.title);
  const strip = el('div', 'ws-saves-strip'); strip.dataset['scroll'] = '';
  let cards: Scope | null = null; // the cards' listeners, renewed with every render
  let reads = 0; // the newest server read: an older one that lands late is dropped
  const render = (server?: ReadonlyMap<string, NewGameSummary>): void => {
    cards?.dispose(); const owner = opts.scope.child('saves.cards'); cards = owner;
    const here = opts.here(), specs = saveCards(catalogueManifests(), isDev());
    if (server === undefined) {
      const read = ++reads;
      void serverPreviews(specs.map((card) => card.instance)).then((found) => { if (read === reads && !owner.disposed && found.size > 0) render(found); return found; }, () => null);
    }
    const rows = specs.map((card) => ({ card, summary: mergedSummary(preview(card.instance), server?.get(card.instance.id)), here: here !== null && here.id === card.instance.id }))
      .filter((row) => row.here || row.card.listed || row.summary === null || hasSave(row.summary));
    rows.sort((a, b) => Number(b.here) - Number(a.here));
    strip.replaceChildren(...rows.map(({ card, summary, here: isHere }) => {
      const box = el('div', 'ws-saves-card'); box.dataset['instance'] = card.instance.id;
      const img = el('div', 'ws-saves-thumb'); img.style.backgroundImage = `url('${card.thumb}')`;
      if (isHere) img.append(el('i', 'ws-saves-here', SAVES_STRINGS.here));
      box.append(img, el('div', 'ws-saves-name', card.name));
      if (summary === null) { box.append(el('div', 'ws-saves-line', SAVES_STRINGS.unreadable)); return box; }
      const [q, inv] = cardLines(summary);
      const go = el('button', 'ws-saves-new', SAVES_STRINGS.newGame); go.type = 'button';
      owner.listen(go, 'click', () => { openSheet(card, summary, opts); });
      box.append(el('div', 'ws-saves-line', q), el('div', 'ws-saves-line', inv), go);
      return box;
    }));
  };
  menu.addSettingsSection('saves.game', [label, strip], { first: true, refresh: () => { render(); } });
}
