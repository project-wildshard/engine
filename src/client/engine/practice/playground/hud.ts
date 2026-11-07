import { uiScope, mountUi } from '../../ui/ownership';
import { app } from '../../app/runtime';
import { engineString } from '../../../../shared/engine/strings';
/**
 * The playgrounds' one HUD chip (E307): the playground's short name, the run's time and ↺ (back to the start), then the
 * status (READY · RUNNING · a pad, a lap) and the best. On the phone it is a row of the base HUD's top-left status column
 * (hudSlots — the one way anything joins the phone HUD, E154), under VITALS and the shard's own rows, clear of the toasts
 * that hang under the minimap; on a desktop, top centre. The HUD's language (navy glass, a cyan hairline, monospace
 * capitals); styled by src/client/engine/ui/styles/playgrounds.css.
 *
 *   const chip = new PlaygroundChip('Grapple', () => restart());
 *   chip.show(true); chip.time(12.34, best); chip.status('RUNNING · P2', 'go')
 */
import '../../ui/styles/playgrounds.css';
import { ROW, hudSlots } from '../../ui/hudSlots';

/**
 * A playground opened (true) or closed (false): the practice listeners hear `ws:practice-active` and the HUD hides what a
 * playground has no use for (`#hud.playground-active`): announced before the HUD flips on, after it flips off.
 */
export function playgroundActive(on: boolean): void {
  const hud = document.getElementById('hud');
  if (on) { document.dispatchEvent(new CustomEvent('ws:practice-active', { detail: true })); hud?.classList.add('playground-active'); return; }
  hud?.classList.remove('playground-active');
  document.dispatchEvent(new CustomEvent('ws:practice-active', { detail: false }));
}

/** 83.4 s → "01:23.4" */
export function clock(s: number): string {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}

/** the playgrounds' one HUD chip: the name, the run's time and best, ↺ and the status */
export class PlaygroundChip {
  readonly scope: ReturnType<typeof uiScope> = uiScope('playgroundChip');
  readonly el: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private shownTime = '';
  private shownBest = '';
  private shownStatus = '';

  constructor(name: string, onRestart: () => void) {
    const el = document.createElement('div');
    el.className = 'ws-pg';
    el.innerHTML = engineString('s_718ae7900c13');
    const q = (sel: string): HTMLElement => el.querySelector<HTMLElement>(sel) ?? el;
    q('b').textContent = name;
    this.timeEl = q('.ws-pg-time'); this.bestEl = q('.ws-pg-best'); this.statusEl = q('.ws-pg-status');
    const restart = q('.ws-pg-restart');
    // pointerup as well as click: iOS drops the synthesized click when a tap jitters (Update.ts); kept off the look pad
    let fired = 0;
    const go = (e: Event): void => { e.stopPropagation(); if (app.clock.real * 1000 - fired < 400) return; fired = app.clock.real * 1000; onRestart(); };
    this.scope.listen(restart, 'pointerup', go);
    this.scope.listen(restart, 'click', go);
    this.scope.listen(restart, 'pointerdown', (e) => { e.stopPropagation(); });
    if (hudSlots.touch) { el.dataset['slot'] = 'row'; hudSlots.widget('band.2', el, ROW.content + 3, this.scope); } // after the shard's own rows
    else mountUi(el, this.scope);
    this.el = el;
  }

  show(on: boolean): void { this.el.classList.toggle('show', on); }

  /** the run's time and the best (null: none yet), written only when the shown text changes */
  time(seconds: number, best: number | null): void {
    const t = clock(seconds), b = best === null ? '' : `BEST ${clock(best)}`;
    if (t !== this.shownTime) { this.shownTime = t; this.timeEl.textContent = t; }
    if (b !== this.shownBest) { this.shownBest = b; this.bestEl.textContent = b; }
  }

  status(text: string, tone: 'rest' | 'go' | 'done' = 'rest'): void {
    const key = `${tone}:${text}`;
    if (key === this.shownStatus) return;
    this.shownStatus = key;
    this.statusEl.textContent = text;
    this.el.dataset['tone'] = tone;
  }
}
