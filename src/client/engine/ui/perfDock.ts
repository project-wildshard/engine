import type { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { mountUi } from './ownership';
/**
 * The Developer dock (A14, Jake 2026-11-10: "the screen is chaotic"): every Developer readout lives in one of two places.
 *
 *   chips     small cards on one row with the frame meter's pill (`.ws-perf-dock`, perf.css): on phones PAUSE's row, right
 *             of PAUSE and left of the minimap; on desktop the top-left corner (QA row 13). The memory
 *             card ("mem 1.13") sits here.
 *   sections  blocks inside the frame meter's details panel, right under its header: a tap on the fps pill opens them.
 *             The worker client's net readout (delay, jitter, corrections, queue, …) is one.
 *
 * Nothing Developer-only is drawn over the world any more: a readout that wants screen room asks for a chip or a
 * section. Both are mounted with `mountUi`, so they leave with their owner's scope.
 */

let row: HTMLElement | null = null;
let panel: HTMLElement | null = null;
/** the sections asking for attention now (a disabled script, a memory limit): the pill carries a red mark while any does */
const alerts = new Set<HTMLElement>(), watched = new WeakSet<HTMLElement>();
const markRow = (): void => {
  for (const el of alerts) if (el.parentElement === null) alerts.delete(el); // discarded ahead of its owner
  row?.classList.toggle('alert', alerts.size > 0);
};

/** The dock's row, made once a page on `document.body` (the frame meter's pill is its first chip). */
export function perfDockRow(): HTMLElement {
  if (row === null || !row.isConnected) {
    // the page's own: every level's chips come and go in it
    row = document.createElement('div'); row.className = 'ws-perf-dock';
    mountUi(row, app.engineScope, document.body); markRow();
  }
  return row;
}

/** The sections' host, which the frame meter's panel holds under its header. */
export function perfDockSections(): HTMLElement {
  if (panel === null) { panel = document.createElement('div'); panel.className = 'ws-perf-sections'; }
  return panel;
}

/** A small card on the dock's row; `order` sorts it after the pill (0). */
export function perfDockChip(el: HTMLElement, scope: Scope, order: number): void {
  el.style.order = String(order);
  mountUi(el, scope, perfDockRow());
}

/** A block in the frame meter's details panel; `order` sorts the blocks. */
export function perfDockSection(el: HTMLElement, scope: Scope, order: number): void {
  el.classList.add('ws-perf-section'); el.style.order = String(order);
  mountUi(el, scope, perfDockSections());
}

/** Mark a section as asking for attention (or not): while any does, the pill shows a red "!" so a tap finds it. */
export function perfDockAlert(el: HTMLElement, scope: Scope, on: boolean): void {
  if (on && !scope.disposed) {
    alerts.add(el);
    if (!watched.has(el)) { watched.add(el); scope.onDispose(() => { alerts.delete(el); markRow(); }); }
  } else alerts.delete(el);
  perfDockRow(); markRow();
}
