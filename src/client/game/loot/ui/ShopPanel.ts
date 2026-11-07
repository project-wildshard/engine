import { app } from '@wildshard/engine/app/runtime';
import type { Scope } from '@wildshard/engine/app/scope';
import type { IconId } from '@wildshard/engine/ui/icons';
import type { UiHandle } from '@wildshard/engine/ui/layers';
import { uiScope, mountUi } from '@wildshard/engine/ui/ownership';
import { itemCardTile, type ItemCardState } from '@wildshard/engine/ui/ItemCard';
import { hudAccent } from '../../session/hudAccent';
/**
 * ShopPanel — the trader's counter (E314 stage 2; SF28, Jake's G87 `art/hud/round-19-ui-kit/B-big-cards-accent.jpg`,
 * the only look since his G181 pick, E450). DOM in `#hud`, styled by src/client/game/loot/ui/shop.css (prefix ws-shop-), in the
 * baseline UI language. The world stays visible above the sheet (the trader at her counter): "<TRADER> · TRADER" and the
 * purse, every good as a big item tile in a 3-up grid (src/client/engine/ui/ItemCard.ts; a tap picks one, ← → step through), and
 * one wide "BUY <NAME> · <price>" bar, all in the shard's HUD accent (session/hudAccent.ts).
 *
 *   const shop = new ShopPanel({ trader: 'Maren', place: 'Driftwood Isle', goods: GOODS, state: (g) => goodState(g, owned, purse.coins),
 *                                coins: () => purse.coins, needs: (g) => 'Whetstone I' });
 *   shop.onBuy = (g) => buyGood(g, owned, purse)     // true: bought (the tile turns OWNED); the host plays the chime / toast
 *   shop.onOpen / shop.onClose                       // the host releases / takes back the pointer lock and the weapons
 *   shop.open() / shop.close() / shop.isOpen / shop.render()   // render(): the purse or Owned changed while open
 *
 * Input: a tap on a tile (or ← →) picks; the bar (or Enter / Space) buys the good picked; CLOSE, Esc or E closes.
 *
 * SF28 part 2: a barter stall declares its deal instead of building DOM. `cost` (what a good takes, as lines: "2 deer
 * hides (3)") replaces the coin price and the purse; `verb` names the deal ("Trade"); the tile's name is `tile`, its foot
 * the good's state in a word, the bar "TRADE <TILE>" with what it takes.
 *
 *   new ShopPanel({ trader: 'Mott', place: '…', goods, state, cost: (g) => [{ text: '2 deer hides (3)', have: true }],
 *                   verb: 'Trade', scope });
 */
import './shop.css';

export interface ShopGood {
  id: string; name: string; does: string; icon: IconId; price: number;
  /** the big tile's name when `name` is a long line (`name` when absent) */
  tile?: string;
}
/** 'full': the buyer has no room for what the good gives (a full quiver) */
export type ShopState = 'owned' | 'locked' | 'short' | 'buy' | 'full';
/** one thing a bartered good takes, as its line reads ("2 deer hides (3)": the trailing count is what the buyer holds) */
export interface ShopCost { readonly text: string; readonly have: boolean }
export interface ShopOpts<G extends ShopGood> {
  trader: string;
  place: string;
  goods: readonly G[];
  state: (g: G) => ShopState;
  /** the purse (absent: a barter stall, no coin and no purse) */
  coins?: () => number;
  /** what a bartered good takes, in place of its coin price */
  cost?: (g: G) => readonly ShopCost[];
  /** the deal's verb on the buttons ("Buy" when absent) */
  verb?: string;
  /** a locked good's prerequisite, by name ("Whetstone I") */
  needs?: (g: G) => string;
  /** the owner the panel's DOM and listeners live and die with (the level's UI scope when absent) */
  scope?: Scope;
}

const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (html !== undefined) e.innerHTML = html; parent?.append(e); return e;
};
const text = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value: string, parent: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = el(tag, cls, parent); e.textContent = value; return e;
};
/** a cost line without the held count ("2 deer hides (3)" → "2 deer hides"), for the big tile's foot and bar */
const bare = (c: ShopCost): string => c.text.replace(/ \(\d+\)$/u, '');

export class ShopPanel<G extends ShopGood> {
  readonly scope: Scope;
  private layer: UiHandle | null = null;
  /** when it opened (real ms): the E press that opened it must not also close it (as DialogueBox) */
  private openT = 0;
  private get open_(): boolean { return this.layer?.active === true; }
  /** the counter: the top (CLOSE, the title) and the G87 sheet */
  private readonly counter: HTMLDivElement;
  onBuy?: (g: G) => boolean;
  onOpen?: () => void;
  onClose?: () => void;

  private i = 0;
  private readonly o: ShopOpts<G>;
  private readonly purse: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly buy: HTMLButtonElement;
  constructor(o: ShopOpts<G>) {
    this.o = o;
    this.scope = o.scope === undefined ? uiScope('shop') : uiScope('shop', o.scope);
    this.counter = el('div', 'ws-shop');
    const top = el('div', 'ws-shop-top', this.counter);
    const close = el('button', 'ws-shop-close', top, `<i>${CROSS}</i>Close`);
    close.type = 'button';
    this.scope.listen(close, 'click', (e) => { e.stopPropagation(); this.close(); });
    const title = el('div', 'ws-shop-title', top); text('b', '', `${o.trader}'s counter`, title); text('span', '', o.place, title);

    const sheet = el('div', 'ws-shop-big ws-glass', this.counter);
    const head = el('div', 'ws-shop-bighead', sheet);
    text('b', 'ws-shop-bigwho', `${o.trader} · Trader`, head);
    this.purse = el('span', 'ws-shop-bigpurse', head);
    this.grid = el('div', 'ws-shop-grid', sheet);
    this.buy = el('button', 'ws-shop-bigbuy', sheet);
    this.buy.type = 'button';
    this.scope.listen(this.buy, 'click', (e) => { e.stopPropagation(); this.tryBuy(); });
    this.scope.listen(this.grid, 'click', (e) => {
      const tile = e.target instanceof Element ? e.target.closest('.ws-icard-tile') : null;
      const k = tile === null ? -1 : [...this.grid.children].indexOf(tile);
      if (k >= 0) { e.stopPropagation(); this.i = k; this.render(); }
    });
    this.scope.listen(this.counter, 'pointerdown', (e) => { e.stopPropagation(); });   // the touch pads under it never see a tap
    this.scope.listen(this.counter, 'touchstart', (e) => { e.stopPropagation(); }, { passive: true });
    // ← → and confirm pick and buy on the counter
    const onTop = (): boolean => this.layer?.top === true;
    app.input.bind('nav.left', () => { this.flip(-1); }, this.scope, onTop);
    app.input.bind('nav.right', () => { this.flip(1); }, this.scope, onTop);
    app.input.bind('confirm', () => { this.tryBuy(); }, this.scope, onTop);
    app.input.bind('use', () => { this.close(); }, this.scope, () => onTop() && app.clock.real * 1000 - this.openT >= 150);
    mountUi(this.counter, this.scope);
  }

  /** the counter (on screen while open) */
  get root(): HTMLDivElement { return this.counter; }

  get isOpen(): boolean { return this.open_; }
  /** the good on the card */
  get shown(): G | undefined { return this.o.goods[this.i]; }

  open(): void {
    if (this.open_ || this.scope.disposed) return;
    // open on the first good still to buy (all bought: the first)
    const first = this.o.goods.findIndex((g) => this.o.state(g) !== 'owned');
    this.i = first === -1 ? 0 : first;
    this.render();
    this.layer = app.ui.push('modal', { root: this.counter, presentation: 'glass', order: -40, back: () => { this.close(); } }, this.scope); this.openT = app.clock.real * 1000;
    this.hideHud(true);
    this.counter.classList.add('show');
    this.onOpen?.();
  }

  close(): void {
    if (!this.open_) return;
    this.layer?.dispose(); this.layer = null;
    this.counter.classList.remove('show');
    this.hideHud(false);
    this.onClose?.();
  }

  /** the HUD under the counter (the touch pads, PAUSE, the minimap, the quest chip) steps aside while it is open, so the
   *  top bar and the trader read clean (board 5 C); the toasts stay (a sale's "Bought · …") */
  private hidden: { el: HTMLElement; was: string }[] = [];
  private hideHud(on: boolean): void {
    if (!on) { for (const h of this.hidden) h.el.style.visibility = h.was; this.hidden = []; return; }
    const hud = this.counter.parentElement;
    if (hud === null) return;
    for (const c of hud.children) {
      if (c === this.counter || !(c instanceof HTMLElement) || c.classList.contains('ws-game-toasts')) continue;
      this.hidden.push({ el: c, was: c.style.visibility });
      c.style.visibility = 'hidden';
    }
  }

  /** pick good `i` (dev / captures) */
  show(i: number): void { this.i = Math.max(0, Math.min(this.o.goods.length - 1, i)); this.render(); }

  flip(d: number): void {
    const n = this.o.goods.length;
    if (n === 0) return;
    this.i = (this.i + d + n) % n;
    this.render();
  }

  private coins(): number { return this.o.coins?.() ?? 0; }
  private needs(g: G): string { return this.o.needs?.(g) ?? ''; }
  private get verb(): string { return this.o.verb ?? 'Buy'; }

  /** the G87 sheet: every good a big tile, the one picked framed in the accent, and the wide BUY bar */
  render(): void {
    const g = this.o.goods[this.i];
    if (!g) return;
    const accent = hudAccent();
    if (accent === null) this.counter.style.removeProperty('--ws-accent'); else this.counter.style.setProperty('--ws-accent', accent);
    this.purse.replaceChildren();
    if (this.o.coins !== undefined) { el('i', 'ws-shop-ring', this.purse); text('b', '', String(this.coins()), this.purse); }
    const FOOT: Record<ShopState, ItemCardState> = { buy: 'buy', short: 'short', owned: 'owned', locked: 'locked', full: 'locked' };
    const barter = this.o.cost;
    const dense = this.o.goods.length > 6;   // seven or more goods: 4-up compact tiles, so the world stays in view
    this.grid.classList.toggle('dense', dense);
    this.grid.replaceChildren(...this.o.goods.map((x, k) => {
      const st = this.o.state(x);
      // a bartered good's foot is its state in a word (the bar spells out what it takes): a cost list wrapped every tile
      const detail = st === 'owned' ? 'Owned' : st === 'locked' ? `Needs ${this.needs(x)}` : st === 'full' ? 'Full'
        : barter === undefined ? undefined : st === 'buy' ? 'Ready' : 'Need more';
      return itemCardTile({ name: x.tile ?? x.name, icon: x.icon, ...(barter === undefined ? { price: x.price } : {}), state: FOOT[st], ...(detail === undefined ? {} : { detail }) }, k === this.i, dense);
    }));
    const st = this.o.state(g), name = g.tile ?? g.name, buy = this.buy;
    buy.className = `ws-shop-bigbuy ${st}`;
    buy.disabled = st !== 'buy';
    const short = barter === undefined ? `Need ${g.price - this.coins()} more` : `Need ${barter(g).filter((c) => !c.have).map(bare).join(' · ')}`;
    buy.textContent = st === 'owned' ? `${name} · Owned` : st === 'locked' ? `Needs ${this.needs(g)}` : st === 'full' ? `${name} · Full`
      : st === 'short' ? short : barter === undefined ? `${this.verb} ${name} · ${g.price}` : `${this.verb} ${name}`;
    if (barter !== undefined && st === 'buy') text('small', '', barter(g).map(bare).join(' · '), buy);
  }

  private tryBuy(): void {
    const g = this.shown;
    if (!g || this.o.state(g) !== 'buy') return;
    if (this.onBuy?.(g) !== true) return;
    this.render();
  }

  dispose(): void { this.close(); this.scope.dispose(); }
}
