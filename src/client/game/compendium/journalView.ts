import { app } from '@wildshard/engine/app/runtime';
import type { UiHandle } from '@wildshard/engine/ui/layers';
import type { Scope } from '@wildshard/engine/app/scope';
import { STATE_ORDER, type EntryDef, type EntryStats, type TrophySlot } from '../../../shared/game/compendium/types';
import type { CompendiumState } from '../../../shared/game/compendium/state';
import { silhouetteOf, loadHandFont, type JournalCallbacks } from './Journal';

const el = (cls: string, text = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
const image = (src: string): HTMLImageElement => {
  const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.decoding = 'async'; img.src = src; return img;
};

/** tab glyphs by tab id (a skin's unknown tab id gets none) */
const GLYPH: Record<string, string> = {
  beasts: '<svg viewBox="0 0 24 24"><path d="M12 21v-7M12 14c-3 0-5-2-6-5M12 14c3 0 5-2 6-5M6 9L4 5M6 9L8 4M6 9L3 9M18 9l2-4M18 9l-2-5M18 9l3 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  elites: '<svg viewBox="0 0 24 24"><path d="M12 3c-4.4 0-7 3-7 6.8 0 2.2 1 3.7 2.4 4.6V18h9.2v-3.6C18 13.5 19 12 19 9.8 19 6 16.4 3 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.3" cy="10.5" r="1.6" fill="currentColor"/><circle cx="14.7" cy="10.5" r="1.6" fill="currentColor"/><path d="M10 18v3M14 18v3" stroke="currentColor" stroke-width="1.6"/></svg>',
  places: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/></svg>',
  trophies: '<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9.5 17h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
const GLYPH_3D = '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

type Dir = 1 | -1;

export class JournalView {
  readonly scope: Scope;
  private readonly host: JournalCallbacks;
  private readonly state: CompendiumState;
  private layer: UiHandle | null = null;
  private get _open(): boolean { return this.layer?.active === true; }
  readonly root: HTMLElement;
  private tabBar: HTMLElement;
  private leaf: HTMLElement;
  private page: HTMLElement;
  private tab: string;
  /** the page index per tab (the book remembers where you were in each) */
  private at = new Map<string, number>();

  private swipe: { x: number; y: number; id: number } | null = null;
  private get onOpen(): (() => void) | undefined { return this.host.onOpen; }
  private get onClose(): (() => void) | undefined { return this.host.onClose; }
  private get onViewModel(): JournalCallbacks['onViewModel'] { return this.host.onViewModel; }

  constructor(state: CompendiumState, root: HTMLElement, scope: Scope, host: JournalCallbacks) {
    this.state = state; this.scope = scope; this.host = host;
    const skin = state.def.skin;
    this.tab = skin.tabs[0]?.id ?? '';
    this.root = root;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', skin.title);
    this.root.inert = true;
    const close = el('ws-cmp-close', 'Close', 'button') as HTMLButtonElement; close.type = 'button';
    this.scope.listen(close, 'click', () => { this.close(); });
    const book = el('ws-cmp-book');
    this.tabBar = el('ws-cmp-tabs');
    for (const t of skin.tabs) {
      const b = el('ws-cmp-tab', '', 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['tab'] = t.id;
      b.innerHTML = GLYPH[t.id] ?? ''; b.append(el('', t.label, 'span'));
      this.scope.listen(b, 'click', () => { this.select(t.id); });
      this.tabBar.append(b);
    }
    this.leaf = el('ws-cmp-leaf');
    this.page = el('ws-cmp-page');
    this.leaf.append(this.page);
    book.append(this.tabBar, this.leaf);
    this.root.append(book, close);

    // a swipe on the page turns it (touch and mouse drag alike); taps fall through to the buttons
    this.scope.listen(this.leaf, 'pointerdown', (e) => { this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    this.scope.listen(this.leaf, 'pointerup', (e) => {
      const s = this.swipe; this.swipe = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) this.turn(dx < 0 ? 1 : -1);
    });
    this.scope.listen(this.leaf, 'pointercancel', () => { this.swipe = null; });
    app.input.bind('nav.right', () => { this.turn(1); }, this.scope, () => this.layer?.top === true);
    app.input.bind('nav.left', () => { this.turn(-1); }, this.scope, () => this.layer?.top === true);
    app.input.bind('tab', () => { this.cycleTab(1); }, this.scope, () => this.layer?.top === true);
    app.input.bind('note', () => { this.close(); }, this.scope, () => this.layer?.top === true);
    state.onUpdate = () => { if (this._open) this.render(); };
  }

  get isOpen(): boolean { return this._open; }

  /** open on the current page, or on `entryId` (its tab, its page) */
  open(entryId?: string): void {
    void loadHandFont();
    if (entryId !== undefined) this.goTo(entryId);
    this.render();
    if (this._open) return;
    this.layer = app.ui.push('gameMenu', { root: this.root, presentation: 'glass', order: 5, back: () => { this.close(); } }, this.scope);
    this.root.inert = false;
    this.root.classList.add('show');
    this.onOpen?.();
  }
  close(): void {
    if (!this._open) return;
    this.layer?.dispose(); this.layer = null;
    this.root.classList.remove('show');
    this.root.inert = true;
    this.onClose?.();
  }
  toggle(): void { if (this._open) this.close(); else this.open(); }

  /** point the book at an entry (its tab and page) */
  goTo(entryId: string): void {
    const e = this.state.entry(entryId);
    if (!e) return;
    this.tab = e.tab;
    this.at.set(e.tab, Math.max(0, this.state.tab(e.tab).findIndex((x) => x.id === entryId)));
  }

  select(tab: string): void { if (tab === this.tab) return; this.tab = tab; this.render(); }
  private cycleTab(dir: Dir): void {
    const tabs = this.state.def.skin.tabs, i = tabs.findIndex((t) => t.id === this.tab);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    if (next) this.select(next.id);
  }

  /** the entries of the current tab (the trophy tab has one page: the wall) */
  private get entries(): EntryDef[] { return this.state.tab(this.tab); }
  private get index(): number { return Math.min(this.at.get(this.tab) ?? 0, Math.max(0, this.entries.length - 1)); }

  /** turn one page; the old page folds away over the new one (forward) or the new one folds in (back) */
  turn(dir: Dir): void {
    const n = this.entries.length, i = this.index + dir;
    if (this.isTrophyTab || i < 0 || i >= n) { this.leaf.classList.remove('bump'); void this.leaf.offsetWidth; this.leaf.classList.add('bump'); return; }
    const old = this.page.cloneNode(true) as HTMLElement;
    old.classList.add('ws-cmp-turn', dir > 0 ? 'out' : 'in');
    old.inert = true;
    this.at.set(this.tab, i);
    this.render();
    if (dir < 0) { this.page.classList.add('ws-cmp-turnin'); old.classList.add('under'); }
    this.leaf.append(old);
    const fresh = this.page;
    const done = (): void => { old.remove(); fresh.classList.remove('ws-cmp-turnin'); };
    this.scope.listen((dir > 0 ? old : fresh), 'animationend', done, { once: true });
    this.scope.timeout(700, done); // reduced motion / a hidden tab never fires animationend
  }

  private get isTrophyTab(): boolean { return this.tab === this.state.def.skin.trophyTab; }

  private render(): void {
    for (const b of this.tabBar.children) (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset['tab'] === this.tab);
    const page = el('ws-cmp-page');
    if (this.isTrophyTab) this.renderWall(page);
    else {
      const e = this.entries[this.index];
      if (e) this.renderEntry(page, e); else page.append(el('ws-cmp-empty', 'Nothing here yet.'));
    }
    this.page.replaceWith(page);
    this.page = page;
  }

  private renderEntry(page: HTMLElement, e: EntryDef): void {
    const skin = this.state.def.skin, s = this.state.stats(e.id);
    const level = STATE_ORDER.indexOf(s.state), named = level >= 1, drawn = level >= 2;
    page.dataset['entry'] = e.id; page.dataset['state'] = s.state;
    const head = el('ws-cmp-head'); head.append(el('ws-cmp-name', named ? e.name : '???', 'h2'));
    if (named && e.subtitle) head.append(el('ws-cmp-sub', e.subtitle));
    if (s.state === 'taken' || (e.kind === 'place' && drawn)) head.append(el('ws-cmp-stamp', skin.stamp(e)));
    page.append(head);
    const plate = el(`ws-cmp-plate${drawn ? '' : ' sil'}${e.kind === 'place' ? ' place' : ''}`);
    const src = drawn ? e.plate.sketch : e.kind === 'place' ? e.plate.sketch : (e.plate.silhouette ?? silhouetteOf(e.plate.sketch));
    plate.append(image(src)); if (!drawn) plate.append(el('ws-cmp-q', '???', 'span'));
    const model = e.plate.model, onView = this.onViewModel;
    if (drawn && model && onView) {
      const b = el('ws-cmp-3d', '', 'button') as HTMLButtonElement; b.type = 'button';
      b.innerHTML = GLYPH_3D; b.append(el('', '3D', 'span'));
      this.scope.listen(b, 'click', () => { onView(model, e); });
      plate.append(b);
    }
    page.append(plate);
    page.append(this.statsRow(e, s));
    const note = drawn ? e.notes : named ? (e.hint ?? 'Heard of, not yet seen.') : 'Not yet found.';
    page.append(el(`ws-cmp-notes${drawn ? '' : ' hint'}`, note, 'p'));
    const near = el('ws-cmp-near');
    const list = this.entries, i = this.index;
    for (const [dir, n] of [[-1, list[i - 1]], [1, list[i + 1]]] as const) near.append(this.neighbour(n, dir));
    page.append(near);
    const count = el('ws-cmp-count'); count.append(document.createElement('i'), document.createTextNode(`${i + 1} / ${list.length}`), document.createElement('i')); page.append(count);
  }

  private statsRow(e: EntryDef, s: EntryStats): HTMLElement {
    const row = el('ws-cmp-stats');
    for (const st of this.state.def.skin.stats(e, s)) {
      const stat = el('ws-cmp-stat'); stat.append(el('', st.label, 'span'), el('', st.value, 'b')); row.append(stat);
    }
    return row;
  }

  /** a neighbour's thumbnail: its sketch once seen, its silhouette and ??? before; an empty slot past either end */
  private neighbour(e: EntryDef | undefined, dir: Dir): HTMLElement {
    if (!e) return el('ws-cmp-nb none');
    const s = this.state.stats(e.id), drawn = STATE_ORDER.indexOf(s.state) >= 2, named = s.state !== 'unknown';
    const src = drawn || e.kind === 'place' ? e.plate.sketch : (e.plate.silhouette ?? silhouetteOf(e.plate.sketch));
    const b = el(`ws-cmp-nb${drawn ? '' : ' sil'}${e.kind === 'place' ? ' place' : ''}`, '', 'button') as HTMLButtonElement;
    b.append(image(src), el('', named ? e.name : '???', 'span'));
    b.type = 'button'; b.dataset['dir'] = String(dir);
    this.scope.listen(b, 'click', () => { this.turn(dir); });
    return b;
  }

  /** the trophy tab: the wall as a grid — taken slots show the sketch and the joke title, the rest the chalk silhouette */
  private renderWall(page: HTMLElement): void {
    const slots: readonly TrophySlot[] = this.state.def.trophies ?? [];
    const taken = slots.filter((t) => this.state.state(t.entry) === 'taken').length;
    page.dataset['entry'] = 'trophies'; page.classList.add('wall');
    const head = el('ws-cmp-head'); head.append(el('ws-cmp-name', 'Trophy Wall', 'h2'), el('ws-cmp-sub', `The ranger's cabin · ${taken} / ${slots.length} taken`)); page.append(head);
    const grid = el('ws-cmp-wall');
    for (const t of slots) {
      const e = this.state.entry(t.entry);
      if (!e) continue;
      const s = this.state.stats(t.entry), got = s.state === 'taken', named = s.state !== 'unknown';
      const card = el(`ws-cmp-slot${got ? ' got' : ''}`, '', 'button') as HTMLButtonElement;
      card.append(image(got ? e.plate.sketch : (e.plate.silhouette ?? silhouetteOf(e.plate.sketch))), el('', named ? e.name : '???', 'b'), el('', got ? t.title : 'Not yet taken', 'span'));
      card.type = 'button';
      this.scope.listen(card, 'click', () => { this.goTo(t.entry); this.render(); });
      grid.append(card);
    }
    page.append(grid);
    page.append(el('ws-cmp-notes', 'Every one on this wall was the hardest thing in the Hollow once. Chalk marks the rest.', 'p'));
  }
}
