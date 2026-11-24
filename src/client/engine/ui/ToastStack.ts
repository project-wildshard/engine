import type { Scope } from '../../../shared/engine/app/scope';
import { uiScope } from './ownership';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { engineString } from '../../../shared/engine/strings';


const MAX = 3;
const LIFE = 3200, OUT = 500, EVERY = 160, GAP = 8;
/** J473 row 5 (Jake, 2026-11-19 grill wave 4: "2.5 s each, a queue of 3"): on a touch HUD the toasts take one slot at the top
 *  centre, one at a time; each shows SLOT_LIFE, at most SLOT_QUEUE are held (the one up and those waiting; past that the oldest
 *  waiting one goes), and plain news said together (within SLOT_MERGE_MS: a quest's STEP COMPLETE and its next OBJECTIVE, said
 *  in one call) is one toast, joined by SLOT_JOIN. */
export const SLOT_LIFE = 2500, SLOT_QUEUE = 3, SLOT_MERGE_MS = 250, SLOT_JOIN = '  ▸  ';
/** top-anchored boxes the column never draws over (only when shown) */
const OBSTACLES = [
  '.ws-elite-bar.pinned.show', '.ws-elite-banner.show',
  '.ws-boss-bar.show', '.ws-boss-reward.show', '.ws-quest-boss.show',
  '.ws-quest-obj.show', '.ws-minimap', '.ws-game-feed',
  // HUD Tidy HT1: the storm badge on the minimap's bottom edge
  '.ws-game-weather.show',
  // J473 row 5: the phone's status column (HP, ammo, a shard's rows) is the band the slot sits under
  '.ws-touch-status',
].join(', ');

/** HUD Tidy: the bars a touch HUD's slot always sits under */
const BOSS_BARS = '.ws-boss-bar.show, .ws-quest-boss.show';

interface Toast { el: HTMLElement; timer: ReturnType<Scope['timeout']>; text: string }
/** a slot toast waiting its turn (J473 row 5) */
interface Waiting { text: string; readonly tone: ToastTone; readonly at: number }
/** `warn`: the amber notice with a warning glyph (G168, a shard's script stopped); `pickup`: a pickup's line on a touch HUD (HUD
 *  Tidy HT2: "no big card, it becomes a line under the boss bar"); `plain`: every other toast. */
export type ToastTone = 'plain' | 'warn' | 'pickup';
const toastClass = (tone: ToastTone): string => `ws-glass ws-game-toast${tone === 'plain' ? '' : ` ws-game-toast-${tone}`}`;

/** where the toasts are on screen right now (viewport px; empty = none up) — the elite's floating name dims under them */
export const toastArea = { left: 0, right: 0, top: 0, bottom: 0 };

export class ToastStack {
  readonly scope: ReturnType<typeof uiScope> = uiScope('ToastStack');
  private live: Toast[] = [];
  private lastLayout = -1e9;
  private shift = 0;

  private readonly box: HTMLElement;
  /** J473 row 5: the touch HUD's slot: the toast up (with when it was said) and those waiting */
  private up: (Toast & { at: number; tone: ToastTone; pinned?: boolean }) | null = null;
  private waiting: Waiting[] = [];
  /** HUD Tidy HT1: the line pinned in the slot (GET LOW while lightning is near): it jumps the queue and stays until unpinned */
  private pinned: string | null = null;
  private readonly now: () => number;
  constructor(box: HTMLElement, now: () => number = diagnosticNow) { this.box = box; this.now = now; }

  /** one slot (a touch HUD) or the column (a keyboard page) */
  private get slot(): boolean { return this.box.closest('#hud.touch') !== null; }

  push(text: string, tone: ToastTone = 'plain'): void {
    if (this.slot) { this.queue(text, tone); return; }
    const last = this.live.at(-1);
    if (last?.text === text && !last.el.classList.contains('out')) { this.arm(last); return; }
    const el = document.createElement('div');
    el.className = toastClass(tone);
    el.textContent = text;
    const t: Toast = { el, timer: 0, text };
    this.box.append(el);
    this.live.push(t);
    this.arm(t);
    while (this.live.length > MAX) { const old = this.live.shift(); if (old) { this.scope.cancelTimer(old.timer); old.el.remove(); } }
    this.layout();
  }

  /** J473 row 5: the slot's queue. Said together with the newest (waiting, or up for under SLOT_MERGE_MS), plain news joins it. */
  private queue(text: string, tone: ToastTone): void {
    const at = this.now(), up = this.up, last = this.waiting.at(-1) ?? (up !== null && !up.el.classList.contains('out') ? up : null);
    if (last !== null && last.text === text) return;
    if (last !== null && tone === 'plain' && last.tone === 'plain' && at - last.at < SLOT_MERGE_MS) {
      last.text = `${last.text}${SLOT_JOIN}${text}`;
      if (last === up) this.paint(up);
      return;
    }
    this.waiting.push({ text, tone, at });
    while (this.waiting.length + (up === null ? 0 : 1) > SLOT_QUEUE) this.waiting.shift();
    if (up !== null) this.paint(up);
    this.next();
  }

  /**
   * HUD Tidy HT1 (Jake 11-24: GET LOW "stays a short message in the quest-message spot" and "jumps the queue"): on a touch HUD
   * `text` takes the slot at once, as a warning, and holds it until `pin(null)`; the line it cut short goes back to the head of
   * the queue. Unpinned, it leaves once it has shown SLOT_LIFE. A keyboard page's column is not touched (null there).
   */
  pin(text: string | null): void {
    if (!this.slot || text === this.pinned) return;
    this.pinned = text;
    const up = this.up;
    if (text === null) {
      if (up !== null && up.pinned === true) { up.pinned = false; if (this.now() - up.at >= SLOT_LIFE) this.leave(up); }
      return;
    }
    if (up !== null) {
      this.scope.cancelTimer(up.timer); up.el.remove(); this.live = []; this.up = null;
      if (up.pinned !== true && !up.el.classList.contains('out')) this.waiting.unshift({ text: up.text, tone: up.tone, at: up.at });
      while (this.waiting.length > SLOT_QUEUE - 1) this.waiting.pop(); // the newest waiting goes, so the cut-short line comes back
    }
    this.show({ text, tone: 'warn', at: this.now() }, true);
  }

  /** the "+N" chip on the line up: how many wait their turn (HT2) */
  private paint(t: Toast): void {
    t.el.textContent = t.text;
    if (this.waiting.length === 0) return;
    const more = document.createElement('span'); more.className = 'ws-game-toast-more'; more.textContent = engineString('s_toast_more', [this.waiting.length]);
    t.el.append(more);
  }

  /** the line up fades out, then the next takes the slot */
  private leave(t: NonNullable<ToastStack['up']>): void {
    this.scope.cancelTimer(t.timer);
    t.el.classList.add('out');
    t.timer = this.scope.timeout(OUT, () => { t.el.remove(); this.live = []; this.up = null; this.next(); });
  }

  /** the next waiting toast takes the slot once it is free */
  private next(): void {
    if (this.up !== null) return;
    if (this.pinned !== null) { this.show({ text: this.pinned, tone: 'warn', at: this.now() }, true); return; }
    const said = this.waiting.shift();
    if (said === undefined) return;
    this.show(said, false);
  }

  /** put `said` in the slot: SLOT_LIFE, or while it is pinned */
  private show(said: Waiting, pinned: boolean): void {
    const el = document.createElement('div');
    el.className = toastClass(said.tone);
    this.box.append(el);
    const t: NonNullable<ToastStack['up']> = { el, timer: 0, text: said.text, at: pinned ? this.now() : said.at, tone: said.tone, pinned };
    this.paint(t);
    this.up = t;
    this.live = [t];
    t.timer = this.scope.timeout(SLOT_LIFE, () => { if (t.pinned !== true) this.leave(t); });
    this.layout();
  }

  /** what the slot shows and holds (tests, proofs) */
  get slotted(): { up: string | null; waiting: string[] } { return { up: this.up?.text ?? null, waiting: this.waiting.map((w) => w.text) }; }
  /** the "+N" the line up shows ('' with none waiting) */
  get more(): string { return this.up?.el.querySelector('.ws-game-toast-more')?.textContent ?? ''; }

  /** every frame: re-lay the column while a toast is up (throttled) */
  tick(): void {
    if (this.live.length === 0) { if (this.shift !== 0) { this.shift = 0; this.box.style.transform = ''; } toastArea.bottom = toastArea.top; return; }
    if (performance.now() - this.lastLayout >= EVERY) this.layout();
  }

  private arm(t: Toast): void {
    this.scope.cancelTimer(t.timer);
    t.el.classList.remove('out');
    t.timer = this.scope.timeout(LIFE, () => {
      t.el.classList.add('out');
      t.timer = this.scope.timeout(OUT, () => { t.el.remove(); const i = this.live.indexOf(t); if (i !== -1) this.live.splice(i, 1); });
    });
  }

  /** push the column below every shown top bar that shares its horizontal band */
  private layout(): void {
    this.lastLayout = performance.now();
    const root = this.box.offsetParent;
    if (!(root instanceof HTMLElement)) return;
    const host = root.getBoundingClientRect();
    const b = this.box.getBoundingClientRect();
    if (b.width === 0) return;
    const home = host.top + this.box.offsetTop;     // the CSS top (offsetTop ignores the transform)
    const left = b.left, right = b.right;
    const rects: DOMRect[] = [];
    for (const o of root.querySelectorAll<HTMLElement>(OBSTACLES)) {
      const r = o.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > left && r.left < right && r.bottom > home) rects.push(r);
    }
    rects.sort((p, q) => p.top - q.top);
    // top to bottom: a bar that starts above the column's (moved) bottom steps it under that bar
    let top = home;
    for (const r of rects) if (r.top < top + Math.max(24, b.height)) top = Math.max(top, r.bottom + GAP);
    // HUD Tidy HT1 and HT2 (Jake 11-24: "it becomes a line under the boss bar"): on a touch HUD the slot is the line under a
    // shown boss bar, never above it, so the fight's messages read in one place
    if (this.slot) for (const o of root.querySelectorAll<HTMLElement>(BOSS_BARS)) {
      const r = o.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > left && r.left < right && r.bottom > home) top = Math.max(top, r.bottom + GAP);
    }
    // never down into the crosshair's band: pushed that far, the oldest toasts go early (the newest always shows)
    const floor = host.top + host.height * 0.5 - 44;
    let h = b.height;
    while (this.live.length > 1 && top + h > floor) {
      const old = this.live.shift();
      if (!old) break;
      this.scope.cancelTimer(old.timer); h -= old.el.offsetHeight + 6; old.el.remove();   // + the column's 6 px gap
    }
    const shift = Math.round(top - home);
    if (shift !== this.shift) { this.shift = shift; this.box.style.transform = shift === 0 ? '' : `translateY(${shift}px)`; }
    toastArea.left = left; toastArea.right = right; toastArea.top = top; toastArea.bottom = top + h;
  }
}
