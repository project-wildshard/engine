import { app } from '@wildshard/engine/app/runtime';
import type { Scope } from '@wildshard/engine/app/scope';
import type { UiHandle } from '@wildshard/engine/ui/layers';
import { uiScope, mountUi } from '@wildshard/engine/ui/ownership';
/**
 * ShardComplete — the "<shard> complete" card (E132, mockup A: art/quest/round-2-complete-screen/A.jpg): a centred glass
 * card over the dimmed last frame. It shows the shard's title, a stats grid, the "still to find" chips and three buttons:
 * KEEP EXPLORING (primary), NEXT SHARD: <name> and TITLE SCREEN. It is data only. A shard's quest hands it a
 * `ShardCompleteData` and platform handlers. Admitted rows use complete/declared; nothing here knows a shard.
 *
 *   const card = new ShardComplete();
 *   card.open(data, { keep, next, title });   // Enter / Esc = keep
 *   card.close();
 *   shardCompleteUp()                          // main.ts's frameGate: the world is frozen while a card is up
 *   setCompleteEntry({ label, open })          // the menu's Achievements tab lists it as a row that reopens the card
 *
 * While it is up, `#hud.ws-complete-up` hides the rest of the HUD and the touch controls; the toasts stay (under the dim).
 */
import './complete.css';

export interface CompleteStat {
  label: string;
  value: string;
  /** 0..1: draws a progress bar under the value (1 = full, in gold) */
  frac?: number;
}

export interface ShardCompleteData {
  /** the small cyan line over the title ("The Sealed Ring · opened") */
  kicker: string;
  /** the shard's name ("Driftwood Isle") */
  title: string;
  /** one or two lines under the title */
  flavour: string[];
  stats: CompleteStat[];
  /** what is still out there, one chip each (empty: the section is left out) */
  todo: string[];
  /** the shard the NEXT SHARD button goes to (its display name) — none: the button is left out */
  next?: string;
}

export interface CompleteHandlers { keep: () => void; next: () => void; title: () => void }

export interface CompleteEntry {
  /** the menu row's name ("Driftwood complete") */
  label: string;
  /** the menu row's second line */
  sub: string;
  open: () => void;
}

let up = 0;
let entry: CompleteEntry | null = null;

/** is a complete card on screen (the world is frozen under it) */
export function shardCompleteUp(): boolean { return up > 0; }
/** the menu row that reopens the card (null: this shard has none yet) */
export function completeEntry(): CompleteEntry | null { return entry; }
export function setCompleteEntry(e: CompleteEntry | null): void { entry = e; }

const hudRoot = (): HTMLElement => document.getElementById('hud') ?? document.body;
const words = (cls: string, value = '', tag = 'div'): HTMLElement => { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; };
const required = (root: HTMLElement, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector); if (node === null) throw new Error(`Missing completion slot ${selector}`); return node;
};

export class ShardComplete {
  private root: HTMLElement | null = null;
  private handlers: CompleteHandlers | null = null;
  private viewScope: Scope | null = null;
  private layer: UiHandle | null = null;

  get isOpen(): boolean { return this.layer?.active === true; }

  open(data: ShardCompleteData, handlers: CompleteHandlers): void {
    this.close();
    this.handlers = handlers;
    const scope = uiScope('complete'); this.viewScope = scope;
    const root = document.createElement('div');
    root.className = 'ws-complete';
    root.innerHTML = `<div class="ws-complete-card" role="dialog">
      <i class="cb tl"></i><i class="cb tr"></i><i class="cb bl"></i><i class="cb br"></i>
      <div class="ws-complete-head">
        <div class="ws-complete-kicker"></div>
        <div class="ws-complete-title"></div>
        <div class="ws-complete-done">· Complete ·</div>
        <div class="ws-complete-flavour"></div>
      </div>
      <div class="ws-complete-rule"></div>
      <div class="ws-complete-grid"></div>
      <div class="ws-complete-btns">
        <button type="button" class="ws-complete-btn pri" data-act="keep">Keep exploring<b>▸</b></button>
        <div class="ws-complete-row2"><button type="button" class="ws-complete-btn sec" data-act="title">Title screen</button></div>
      </div>
    </div>`;
    required(root, '.ws-complete-card').setAttribute('aria-label', `${data.title} complete`);
    required(root, '.ws-complete-kicker').textContent = data.kicker; required(root, '.ws-complete-title').textContent = data.title;
    const flavour = required(root, '.ws-complete-flavour');
    data.flavour.forEach((line, index) => { if (index > 0) flavour.append(document.createElement('br')); flavour.append(document.createTextNode(line)); });
    const grid = required(root, '.ws-complete-grid');
    for (const stat of data.stats) {
      const row = words('ws-complete-stat'); row.append(words('ws-complete-lab', stat.label), words(`ws-complete-val${stat.value.length > 7 ? ' sm' : ''}`, stat.value));
      if (stat.frac !== undefined) {
        const bar = words(`ws-complete-bar${stat.frac >= 1 ? ' full' : ''}`), fill = document.createElement('i');
        fill.style.width = `${Math.round(Math.min(1, Math.max(0, stat.frac)) * 100)}%`; bar.append(fill); row.append(bar);
      }
      grid.append(row);
    }
    if (data.todo.length > 0) {
      const todo = words('ws-complete-todo'); data.todo.forEach((value, index) => { if (index > 0) todo.append(document.createTextNode(' ')); todo.append(words('', value, 'span')); });
      grid.after(words('ws-complete-rule'), words('ws-complete-lab', 'Still to find'), todo);
    }
    const row2 = required(root, '.ws-complete-row2'); row2.classList.toggle('one', data.next === undefined);
    if (data.next !== undefined) {
      const next = document.createElement('button'); next.type = 'button'; next.className = 'ws-complete-btn sec'; next.dataset['act'] = 'next';
      next.append(words('', 'Next shard:', 'small'), document.createTextNode(data.next)); row2.prepend(next);
    }
    scope.listen(root, 'click', (e) => {
      const t = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      const act = t instanceof HTMLElement ? t.dataset['act'] : undefined;
      if (act === 'keep') handlers.keep();
      else if (act === 'next') handlers.next();
      else if (act === 'title') handlers.title();
    });
    const hud = hudRoot();
    mountUi(root, scope, hud);
    this.layer = app.ui.push('modal', { root, order: -20, back: () => { this.handlers?.keep(); } }, scope);
    app.input.bind('confirm', () => { this.handlers?.keep(); }, scope, () => this.layer?.top === true);
    hud.classList.add('ws-complete-up');
    this.root = root;
    up++;

    scope.raf(() => {
      root.classList.add('show');
      if (matchMedia('(hover: hover)').matches) root.querySelector<HTMLButtonElement>('[data-act="keep"]')?.focus({ preventScroll: true }); // keyboards only: a phone would draw the focus ring
    });
  }

  close(): void {
    if (this.root === null) return;
    this.root.remove();
    this.root = null;
    this.handlers = null;
    up = Math.max(0, up - 1);
    if (up === 0) hudRoot().classList.remove('ws-complete-up');
    this.layer?.dispose(); this.layer = null; this.viewScope?.dispose(); this.viewScope = null;
  }
}
