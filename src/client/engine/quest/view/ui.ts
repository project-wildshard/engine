import type { UiHandle } from '../../ui/layers';
import { DialogueClock } from '../../../../shared/engine/quest/dialogueClock';
import { uiScope, mountUi } from '../../ui/ownership';
import { engineString } from '../../../../shared/engine/strings';
/**
 * The adventure's own HUD pieces (kept out of HUD.ts, which the HUD agent owns) — DOM in `#hud`, styled by
 * src/client/engine/ui/styles/quest.css (prefix ws-quest-):
 *
 *   ObjectiveLine — the quest chip (E51, mockup G art/quest/round-1-compact/G.jpg): ONE slim glass line under the
 *                   minimap, right-aligned to it — ◆ "GLYPH SHARDS 1/3" | "SEA CAVE 230 M" ▲ (the arrow turns with the
 *                   nearest marker's bearing). Pulses cyan when the goal or its count changes. The chapter title, the full
 *                   objective and its sub-steps are on the menu's MAP tab (FullMap.setQuest) and in the step toasts.
 *   DialogueBox   — the NPC dialogue panel: name, a typed-out line, "[E] NEXT"; E / the touch USE / a tap advances,
 *                   a line still typing completes first.
 *   RewardCaption — the big centred caption over the golden-hour reward view.
 */
import '../../ui/styles/quest.css';
import type { Scope } from '../../../../shared/engine/app/scope';
import { app } from '../../app/runtime';

const hudRoot = (): HTMLElement => document.getElementById('hud') ?? document.body;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; parent?.append(e); return e;
};

/** the quest chip: one slim glass line under the minimap with the goal, its count and the nearest marker's bearing */
export class ObjectiveLine {
  readonly scope: Scope = uiScope('objective');
  readonly root: HTMLDivElement = el('div', 'ws-quest-obj');
  private goal = el('span', 'ws-quest-obj-goal', this.root);
  private label = el('span', 'ws-quest-obj-label', this.goal);
  private count = el('span', 'ws-quest-obj-count', this.goal);
  private sep = el('span', 'ws-quest-obj-sep', this.root);
  private nav = el('span', 'ws-quest-obj-nav', this.root);
  private navName = el('span', 'ws-quest-obj-name', this.nav);
  private navDist = el('span', 'ws-quest-obj-dist', this.nav);
  private arrow = el('span', 'ws-quest-obj-arrow', this.nav);
  private last = '';
  private lastNav = '';
  private placeT = -Infinity;
  private placing: ResizeObserver | null = null;

  constructor() {
    this.root.prepend(el('i', 'ws-quest-obj-dia'));
    this.arrow.textContent = engineString('s_671fd067cc0e');
    this.sep.style.display = this.nav.style.display = 'none';
    mountUi(this.root, this.scope, hudRoot());
  }

  /** the chip's goal: a short label ("Glyph shards") and its counter ("1/3", or '') — pulses cyan when either changes */
  set(label: string, count: string): void {
    const key = `${label}|${count}`;
    if (key === this.last) return;
    if (this.last !== '') { this.root.classList.remove('pulse'); void this.root.offsetWidth; this.root.classList.add('pulse'); }
    this.last = key;
    this.label.textContent = label;
    this.count.textContent = count;
    this.count.style.display = count ? '' : 'none';
    this.root.classList.toggle('show', label !== '');
  }

  /** hide the chip while a caption has the screen (`ws-quest-hide`); it keeps its place and its goal */
  hide(on: boolean): void { this.root.classList.toggle('ws-quest-hide', on); }

  /** the nearest marker: short name, metres, and its bearing relative to the view (radians, 0 = straight ahead, + = right) */
  setNav(name: string | null, metres: number, rel: number): void {
    if (name === null) {
      if (this.lastNav !== '') { this.lastNav = ''; this.sep.style.display = this.nav.style.display = 'none'; }
      return;
    }
    if (this.lastNav === '') this.sep.style.display = this.nav.style.display = '';
    if (name !== this.lastNav) { this.lastNav = name; this.navName.textContent = name; }
    const d = `${Math.round(metres)} m`;
    if (this.navDist.textContent !== d) this.navDist.textContent = d;
    const turn = `rotate(${Math.round((rel * 180) / Math.PI)}deg)`; // FC14: whole degrees, written only on change
    if (this.arrow.style.transform !== turn) this.arrow.style.transform = turn;
  }

  /** keep it under the minimap, right-aligned to its right edge (the minimap's size and top differ per layout and the
   *  home-screen mode); the toasts stack under it (A1, HUD.toast). Called every frame: it looks for the minimap ~once a
   *  second, then places the chip from the minimap's and the HUD's size reports, read right after a layout (a read here,
   *  on the frame the HUD was built, forced a whole-page layout). */
  update(t: number): void {
    if (this.placing !== null || t - this.placeT < 1) return;
    this.placeT = t;
    const mini = document.querySelector('.ws-minimap'), parent = this.root.parentElement;
    if (!(mini instanceof HTMLElement)) return;
    const placing = this.placing = new ResizeObserver(() => { this.place(mini); });
    placing.observe(mini); if (parent !== null) placing.observe(parent);
    this.scope.onDispose(() => { placing.disconnect(); });
  }

  private place(mini: HTMLElement): void {
    const r = mini.getBoundingClientRect();
    if (r.bottom <= 0) return;
    const host = this.root.offsetParent?.getBoundingClientRect() ?? { top: 0, right: window.innerWidth };
    this.root.style.top = `${Math.round(r.bottom - host.top + 12)}px`;   // clear of the rim's ticks (they poke 6–8 px out)
    this.root.style.right = `${Math.round(host.right - r.right)}px`;
  }
}

/** the NPC dialogue panel: the speaker's name and the typed-out lines, advanced with E or a tap */
export class DialogueBox {
  readonly root: HTMLDivElement = el('div', 'ws-quest-talk');
  private name = el('div', 'ws-quest-talk-name', this.root);
  private text = el('div', 'ws-quest-talk-text', this.root);
  private foot = el('div', 'ws-quest-talk-foot', this.root);
  private page = el('span', '', this.foot);
  private next = el('b', '', this.foot);
  private readonly clock = new DialogueClock();
  private layer: UiHandle | null = null;
  private get open_(): boolean { return this.layer?.active ?? false; }
  private finish_: (() => void) | null = null;
  private openT = 0;
  private readonly scope: Scope;
  /** chars per second of the type-out */
  cps = 60;

  /** E (desktop) and a tap anywhere on the box (touch) advance it; the game's "[E]" prompt is hidden while it is open */
  constructor(scope: Scope = uiScope('dialogue')) {
    this.scope = scope;
    mountUi(this.root, this.scope, hudRoot());
    scope.listen(this.root, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.advance(); });
    for (const action of ['use', 'confirm'] as const) app.input.bind(action, () => { this.advance(); }, scope,
      () => this.open_ && (this.layer?.top ?? false) && app.clock.real * 1000 - this.openT >= 150);
    scope.onDispose(() => { this.close(false); this.root.remove(); });
  }

  dispose(): void { this.scope.dispose(); }

  get isOpen(): boolean { return this.open_; }
  /** Lend the panel's actual clock to a reading opened by its NPC owner. */
  get readingClock():DialogueClock {return this.clock;}

  open(name: string, lines: string[], onDone: () => void): void {
    if (lines.length === 0) { onDone(); return; }
    this.name.textContent = name;
    this.clock.open(lines); this.finish_ = onDone; this.layer?.dispose();
    this.layer = app.ui.push('modal', { root: this.root, presentation: 'world', order: -42, yieldsToMenu: true, back: () => { this.close(false); } }, this.scope); this.openT = app.clock.real * 1000;
    this.root.classList.add('show');
    this.render();
  }

  /** E / tap: finish the typing, else the next line, else close */
  advance(): void {
    if (!this.open_) return;
    if (this.clock.advance() === 'finished') { this.close(true); return; }
    this.render();
  }

  close(finished = false): void {
    if (!this.open_) return;
    this.layer?.dispose(); this.layer = null; this.clock.close();
    this.root.classList.remove('show');
    const done = this.finish_; this.finish_ = null;
    if (finished) done?.();
  }

  update(dt: number): void {
    if (!this.open_) return;
    if (this.clock.update(dt, this.cps)) this.render();
  }

  private render(): void {
    this.text.textContent = this.clock.text;
    this.page.textContent = engineString('s_9404497cf77d', [this.clock.index + 1, this.clock.count]);
    const touch = document.getElementById('hud')?.classList.contains('touch') === true;
    this.next.textContent = engineString('s_4ecdc2db1bc2', [touch ? '' : engineString('s_4f911ee89601'), this.clock.index + 1 < this.clock.count ? engineString('s_c93aad5dddf0') : engineString('s_f13a1ed0cf3c')]);
  }
}

/** the reward caption: a kicker, a title and a sub line, shown when a quest pays out */
export class RewardCaption {
  readonly scope: Scope = uiScope('reward');
  readonly root: HTMLDivElement = el('div', 'ws-quest-reward');
  constructor(kicker: string, title: string, sub: string) {
    el('div', 'ws-quest-reward-kicker', this.root).textContent = kicker;
    el('div', 'ws-quest-reward-title', this.root).textContent = title;
    el('div', 'ws-quest-reward-sub', this.root).textContent = sub;
    mountUi(this.root, this.scope, hudRoot());
  }
  show(on: boolean): void { this.root.classList.toggle('show', on); }
}
