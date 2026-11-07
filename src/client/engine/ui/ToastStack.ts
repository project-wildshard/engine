import type { Scope } from '../../../shared/engine/app/scope';
import { uiScope } from './ownership';


const MAX = 3;
const LIFE = 3200, OUT = 500, EVERY = 160, GAP = 8;
/** top-anchored boxes the column never draws over (only when shown) */
const OBSTACLES = [
  '.ws-elite-bar.pinned.show', '.ws-elite-banner.show',
  '.ws-boss-bar.show', '.ws-boss-reward.show', '.ws-quest-boss.show',
  '.ws-quest-obj.show', '.ws-minimap', '.ws-game-feed',
].join(', ');

interface Toast { el: HTMLElement; timer: ReturnType<Scope['timeout']>; text: string }
/** `warn`: the amber notice with a warning glyph (G168, a shard's script stopped); `plain`: every other toast. */
export type ToastTone = 'plain' | 'warn';

/** where the toasts are on screen right now (viewport px; empty = none up) — the elite's floating name dims under them */
export const toastArea = { left: 0, right: 0, top: 0, bottom: 0 };

export class ToastStack {
  readonly scope: ReturnType<typeof uiScope> = uiScope('ToastStack');
  private live: Toast[] = [];
  private lastLayout = -1e9;
  private shift = 0;

  private readonly box: HTMLElement;
  constructor(box: HTMLElement) { this.box = box; }

  push(text: string, tone: ToastTone = 'plain'): void {
    const last = this.live.at(-1);
    if (last?.text === text && !last.el.classList.contains('out')) { this.arm(last); return; }
    const el = document.createElement('div');
    el.className = tone === 'warn' ? 'ws-glass ws-game-toast ws-game-toast-warn' : 'ws-glass ws-game-toast';
    el.textContent = text;
    const t: Toast = { el, timer: 0, text };
    this.box.append(el);
    this.live.push(t);
    this.arm(t);
    while (this.live.length > MAX) { const old = this.live.shift(); if (old) { this.scope.cancelTimer(old.timer); old.el.remove(); } }
    this.layout();
  }

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
