import { icon, type IconId } from './icons';
import { uiScope, mountUi } from './ownership';
import type { Scope } from '../../../shared/engine/app/scope';
import './styles/itemcard.css';

/**
 * The big item card (SHARD-PLATFORM SF28, Jake's G87 pick: `art/hud/round-19-ui-kit/B-big-cards-accent.jpg`): one item as a
 * large tile (a dark image well with the item's icon, its NAME, then a price, a count or a state line) in the level's HUD
 * accent. Content never builds this DOM: it hands the platform an `ItemCardSpec` (plain data) and the platform draws it, in
 * a shop grid (`itemCardTile`) or as the pickup / reward card that pops under the top bar (`ItemCardPop`).
 *
 *   const tile = itemCardTile({ name: 'Bolts ×10', icon: 'item.bolt', price: 15, state: 'buy' });
 *   const pop = new ItemCardPop(); pop.show({ name: 'Deer hide', icon: 'item.deer-hide', detail: '3 in the pack' }, 'Picked up', '#89c06a');
 *
 * Every string lands as `textContent` (SF58); the icon is an engine icon id (audited SVG). The accent arrives as data, a hex
 * set as `--ws-accent` on the card's root (the HUD's cyan when none). Styled by src/client/engine/ui/styles/itemcard.css (ws-icard-).
 */

/** what the tile's foot says: a price to pay, a price out of reach, owned, locked, sold out, or just shown (a pickup) */
export type ItemCardState = 'buy' | 'short' | 'owned' | 'locked' | 'out' | 'shown';
/** one item as the platform's card data (content hands this, never DOM) */
export interface ItemCardSpec {
  readonly name: string;
  readonly icon: IconId;
  /** a second line under the name (a pickup's "3 in the pack", a locked good's "Needs Whetstone I") */
  readonly detail?: string;
  /** the price, drawn after the accent ring (only for 'buy' / 'short') */
  readonly price?: number;
  readonly state?: ItemCardState;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; parent?.append(e); return e;
};
const text = (tag: 'b' | 'span', cls: string, value: string, parent: HTMLElement): void => { el(tag, cls, parent).textContent = value; };

/** A grid tile for one item (a shop's goods). `selected` draws the accent frame; `compact` sets the words a size down (a 4-up grid). */
export function itemCardTile(spec: ItemCardSpec, selected = false, compact = false): HTMLElement {
  const state = spec.state ?? 'shown';
  const tile = el('div', `ws-icard-tile ${state}${selected ? ' on' : ''}${compact ? ' compact' : ''}`);
  const well = el('i', 'ws-icard-well', tile);
  const glyph = el('i', 'ws-icard-icon', well);
  glyph.prepend(svgOf(spec.icon));
  text('b', 'ws-icard-name', spec.name, tile);
  const foot = el('span', 'ws-icard-foot', tile);
  if ((state === 'buy' || state === 'short') && spec.price !== undefined) { el('i', 'ws-icard-ring', foot); foot.append(document.createTextNode(String(spec.price))); }
  else if (spec.detail !== undefined) foot.textContent = spec.detail;
  return tile;
}

/** the icon's audited SVG as an element (the engine's own glyph registry; no content markup) */
function svgOf(id: IconId): Element {
  const t = document.createElement('template');
  t.innerHTML = icon(id);
  return t.content.firstElementChild ?? document.createElement('i');
}

const LIFE = 2600, OUT = 400;

/** The pickup / reward card: one big card under the top bar, the newest replacing the last. */
export class ItemCardPop {
  readonly scope: Scope;
  readonly root: HTMLElement;
  private timer: ReturnType<Scope['timeout']> = 0;
  constructor(parent?: HTMLElement, owner?: Scope) {
    this.scope = owner === undefined ? uiScope('ItemCardPop') : uiScope('ItemCardPop', owner);
    this.root = el('div', 'ws-icard-pop');
    this.root.setAttribute('role', 'status');
    mountUi(this.root, this.scope, parent);
  }

  /** show `spec` under a small kicker line ("Picked up", "Reward") in `accent` (a hex; the HUD cyan when null) */
  show(spec: ItemCardSpec, kicker: string, accent: string | null): void {
    if (accent === null) this.root.style.removeProperty('--ws-accent'); else this.root.style.setProperty('--ws-accent', accent);
    const card = el('div', 'ws-icard-card');
    const well = el('i', 'ws-icard-well', card);
    el('i', 'ws-icard-icon', well).append(svgOf(spec.icon));
    const words = el('div', 'ws-icard-words', card);
    text('span', 'ws-icard-kicker', kicker, words);
    text('b', 'ws-icard-name', spec.name, words);
    if (spec.detail !== undefined) text('span', 'ws-icard-detail', spec.detail, words);
    this.root.replaceChildren(card);
    this.root.classList.remove('out', 'show'); void this.root.offsetWidth; this.root.classList.add('show');
    this.scope.cancelTimer(this.timer);
    this.timer = this.scope.timeout(LIFE, () => {
      this.root.classList.add('out');
      this.timer = this.scope.timeout(OUT, () => { this.root.classList.remove('show', 'out'); this.root.replaceChildren(); });
    });
  }

  /** the card on screen (null: none) */
  get shown(): string | null { return this.root.classList.contains('show') ? this.root.querySelector('.ws-icard-name')?.textContent ?? null : null; }

  dispose(): void { this.scope.dispose(); }
}
