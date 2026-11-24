import type { Scope } from '../../../shared/engine/app/scope';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { engineString } from '../../../shared/engine/strings';
import { ROOMS_PING_EVENT, ROOMS_PING_EVERY_MS, type RoomsPing } from '../net/roomsPing';
import { perfDockChip } from './perfDock';

/**
 * The Developer dock's ping chip (QA-FEEDBACK 11-24 row 36): "48 ms", the rooms link's live round trip, after the fps pill and
 * the memory card. It reads the `ws:rooms-ping` event (net/roomsPing.ts) the online link sends once a second, and shows "--"
 * when none came lately: offline, a preview, a link that dropped. Perf.ts shows and hides it with its fps pill.
 *
 *   const chip = installPingChip(scope); chip.hidden = !isDev();
 */
/** the dock's order: the fps pill 0, the memory card 10, the ping 20 */
export const PING_ORDER = 20;
/** no word from the link for this long reads as no link */
export const PING_STALE_MS: number = 2.5 * ROOMS_PING_EVERY_MS;

export function installPingChip(scope: Scope, now: () => number = diagnosticNow): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ws-perf-ping';
  root.setAttribute('role', 'status');
  const value = document.createElement('b');
  root.append(value);
  let heard = -Infinity, shown = '';
  const paint = (ms: number | null): void => {
    const text = ms === null ? engineString('s_ping_none') : String(ms);
    if (text === shown) return;
    shown = text; value.textContent = text; root.setAttribute('aria-label', ms === null ? engineString('s_ping_label_none') : engineString('s_ping_label', [text]));
  };
  paint(null);
  scope.listen(document, ROOMS_PING_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return;
    const said = event.detail as RoomsPing;
    heard = now(); paint(said.rttMs);
  });
  scope.interval(ROOMS_PING_EVERY_MS, () => { if (now() - heard > PING_STALE_MS) paint(null); });
  perfDockChip(root, scope, PING_ORDER);
  return root;
}
