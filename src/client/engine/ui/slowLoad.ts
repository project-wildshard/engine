/**
 * QA 11-19 row 17 (Jake, ~12:18 Cancún: "I have no idea what the waiting state is about ... There's no like error model of
 * worst case here"): the worst case of a load that stops moving, before the fatal card. When a step passes its own deadline
 * with no progress (`stuckStep.ts` `slowStepMs`), the loading card shows what it is stuck on and for how long, a connection
 * check (offline, the page's origin answering and how fast, or not answering), RETRY (a reload into the same place) and EXIT
 * TO TITLE. The composition root sends the non-fatal report beside it (`app/entry.ts`), and the strip goes once loading moves
 * again. The fatal card still follows at the stuck bound.
 */
import type { Scope } from '../../../shared/engine/app/scope';
import { listenTap } from '../input/dom';
import { leaveSaved, markReload, markUnload } from '../boot/lastEnd';
import { leftByPlayer } from '../boot/dropNotice';
import { exitTitleUrl } from './Loading';
import { mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { replaceFresh } from '../boot/freshPage';

/** What the connection check found. */
export type ConnectionCheck =
  | { readonly state: 'offline' }
  | { readonly state: 'ok'; readonly ms: number }
  | { readonly state: 'slow'; readonly ms: number }
  | { readonly state: 'down'; readonly why: string };

/** A check slower than this answered, but the link is part of the problem. */
export const SLOW_LINK_MS = 1500;
/** The check gives up after this long. */
export const CHECK_DEADLINE_MS = 5000;

export interface ConnectionPorts {
  readonly online: () => boolean;
  readonly read: (url: string, signal: AbortSignal) => Promise<{ readonly ok: boolean; readonly status: number }>;
  readonly now: () => number;
  /** resolves after `ms` (the owner's timer) */
  readonly wait: (ms: number) => Promise<void>;
}

/** One small no-store read of the page's own `version.json`: the device's link, and the page's origin, answer or not. */
export function checkConnection(ports: ConnectionPorts, url?: string, deadline?: number): Promise<ConnectionCheck> {
  const deadlineMs = deadline ?? CHECK_DEADLINE_MS;
  if (!ports.online()) return Promise.resolve({ state: 'offline' });
  const abort = new AbortController(), started = ports.now();
  const late = ports.wait(deadlineMs).then(() => { abort.abort(); return { state: 'down', why: `no answer in ${String(Math.round(deadlineMs / 1000))} s` } as const; });
  const read = ports.read(`${url ?? '/version.json'}?check=${String(Math.round(started))}`, abort.signal).then((response): ConnectionCheck => {
    const ms = Math.round(ports.now() - started);
    if (!response.ok) return { state: 'down', why: `the page answered ${String(response.status)}` };
    return ms > SLOW_LINK_MS ? { state: 'slow', ms } : { state: 'ok', ms };
  }, (): ConnectionCheck => ({ state: 'down', why: 'the request failed' }));
  return Promise.race([read, late]);
}

/** The check in a player's words. */
export function connectionLine(check: ConnectionCheck | null): string {
  if (check === null) return 'Connection: checking…';
  if (check.state === 'offline') return 'Connection: this device is offline';
  if (check.state === 'ok') return `Connection: OK (${String(check.ms)} ms)`;
  if (check.state === 'slow') return `Connection: slow (${String(check.ms)} ms)`;
  return `Connection: the game's server did not answer (${check.why})`;
}

/** The strip's headline: the step and how long it has not moved. */
export function slowLine(step: string, stuckMs: number): string {
  return `Loading has not moved for ${String(Math.round(stuckMs / 1000))} s · stuck at "${step}"`;
}

/** Show the slow strip on `card` (or over the page when no card is up). Returns its removal. */
export function showSlowLoad(owner: Scope, step: string, stuckMs: number, card: HTMLElement | null): () => void {
  const scope = owner.child('slow-load');
  const box = document.createElement('div');
  box.className = 'ws-load-slow'; box.setAttribute('role', 'alert'); box.dataset['slowStep'] = step;
  box.style.cssText = 'flex:none;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:calc(100% - 32px);max-width:560px;margin:8px auto;padding:12px;'
    + 'border:1px solid #ffb547;background:rgba(13,27,38,0.92);color:#e8f5fa;font:12px/1.45 monospace;z-index:2147483000';
  if (card === null) box.style.cssText += ';position:fixed;left:16px;right:16px;bottom:max(16px,env(safe-area-inset-bottom));width:auto';
  const head = document.createElement('div'); head.style.cssText = 'color:#ffb547;letter-spacing:0.12em;text-transform:uppercase'; head.textContent = engineString('s_loading_slow_head');
  const what = document.createElement('div'); what.textContent = slowLine(step, stuckMs);
  const link = document.createElement('div'); link.dataset['el'] = 'connection'; link.textContent = connectionLine(null);
  const sent = document.createElement('div'); sent.style.opacity = '0.7'; sent.textContent = engineString('s_loading_slow_sent');
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px';
  const button = (name: string, text: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset['slow'] = name; b.textContent = text;
    b.style.cssText = 'flex:1 1 0;min-height:48px;border:1px solid #8fe3ff;background:#0d1b26;color:#8fe3ff;font:11px monospace;letter-spacing:0.2em;text-transform:uppercase;cursor:pointer;touch-action:manipulation';
    listenTap(scope, b, () => { b.disabled = true; run(); });
    row.append(b); return b;
  };
  button('retry', engineString('s_loading_retry'), () => { leaveSaved(() => { leftByPlayer(); markReload(`slow loading retry at ${step}`); location.reload(); }); });
  button('exit', engineString('s_loading_exit'), () => { leaveSaved(() => { leftByPlayer(); markUnload(`exit to title from the slow loading card at ${step}`); replaceFresh(exitTitleUrl(location.href)); }); });
  box.append(head, what, link, sent, row);
  mountUi(box, scope, card ?? document.body, card?.querySelector('.ws-load-menu') ?? null);
  scope.onDispose(() => { box.remove(); });
  void checkConnection({
    online: () => typeof navigator === 'undefined' || navigator.onLine,
    read: (url, signal) => fetch(url, { cache: 'no-store', signal }),
    now: diagnosticNow,
    wait: (ms) => new Promise<void>((resolve) => { scope.timeout(ms, resolve); }),
  }).then((check) => { if (!scope.disposed) { link.textContent = connectionLine(check); box.dataset['connection'] = check.state; } return check; });
  return () => { scope.dispose(); };
}
