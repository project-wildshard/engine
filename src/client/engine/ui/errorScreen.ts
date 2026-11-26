import { leaveSaved, markReload, markUnload, runningZone } from '../boot/lastEnd';
import { showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';
import { engineString } from '../../../shared/engine/strings';
import type { LoadFailure } from '../core/errorReport';
import { app } from '../app/runtime';
import { uiScope, mountUi } from './ownership';
import { trapFocus } from './focusTrap';
import { listenTap } from '../input/dom';
import { copyText, diagnosticsSource, DOCTOR_EARLIER_KEY } from './diagnosticsCopy';
import { Scope } from '../../../shared/engine/app/scope';
import { showFailure, clearFailure } from '../telemetry/runtime';
import type { FailureClear } from '../telemetry/model';

const scope = uiScope('loadFailure', app.engineScope);

/*
 * E7.5 prep (Jake, 2026-11-09): the way into the Connection doctor, beside the failure screen that offers it. The doctor is its
 * own small page (`doctor/index.html`), so it opens even when this page's worker, packs or renderer are what broke. `?sw=0`
 * takes the navigation past the service worker, which answers every other navigation with the game's document. The page's
 * Copy diagnostics report (LS4), when there is one, rides along in sessionStorage so the doctor's Copy report carries both.
 */
/** A build stamped with a world (`WILDSHARD_RELEASE_URL`): only these show the title's Check connection. */
export function hasOnlineWorld(): boolean { return (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined; }

/** The doctor's address from this page: where it came from. The zone it was loading rides in the same-origin handoff (CHUNK-PARAM
 *  CP7, J522), never in the address. */
export function doctorUrl(from: string, at: Location = location): string {
  const url = new URL('/doctor/', at.origin);
  url.searchParams.set('sw', '0'); url.searchParams.set('from', from);
  return url.href;
}

/** FM8 mode 14: how long the doctor's preflight may take before it counts as failed. */
const DOCTOR_PREFLIGHT_MS = 8000;
/** FM8 mode 14 (meta MMO-FAILURE-MODES-PLAN): a same-origin preflight of the doctor's own page. It says only that this one
 *  request answered now; it can't promise the document's later reads will, so a pass never claims more. Null when it answered. */
export async function doctorPreflight(url: string, read: typeof fetch = fetch, deadlineMs: number = DOCTOR_PREFLIGHT_MS): Promise<string | null> {
  const abort = new AbortController(), timer = setTimeout(() => { abort.abort(); }, deadlineMs);
  try {
    const response = await read(url, { method: 'HEAD', cache: 'no-store', signal: abort.signal });
    return response.ok ? null : engineString('s_doctor_http_status', [response.status]);
  } catch { return abort.signal.aborted ? engineString('s_doctor_http_slow', [Math.round(deadlineMs / 1000)]) : engineString('s_doctor_http_none'); }
  finally { clearTimeout(timer); }
}
/** The doctor-http card on screen, if any: a new one (or a repeated `ws:doctor`) closes it, scope and all. */
let doctorCardClose: ((cause: FailureClear) => void) | null = null;
/** FM8 mode 14's card: the doctor didn't open, and this page stays as it was. Try again re-checks with the card up (a failure
 *  replaces it, a pass leaves the page); Back closes the card. */
function doctorHttpCard(measured: string, again: () => Promise<boolean>): void {
  doctorCardClose?.('replaced');
  const card = document.createElement('div'), box = document.createElement('div'), title = document.createElement('h1'), body = document.createElement('p');
  const retry = document.createElement('button'), back = document.createElement('button'), details = document.createElement('details'), summary = document.createElement('summary'), fact = document.createElement('p');
  card.dataset['failmode'] = 'doctor-http'; card.dataset['tone'] = 'warn'; card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', engineString('s_doctor_http_title'));
  card.style.cssText = 'position:fixed;inset:0;z-index:2147482600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,9,14,.62);color:#e6f2f8;font:12px/1.5 "JetBrains Mono",Menlo,monospace';
  box.style.cssText = 'width:min(440px,100%);padding:22px 18px 16px;background:rgba(13,27,38,.92);border:1px solid rgba(143,227,255,.35);display:flex;flex-direction:column;gap:10px';
  title.textContent = engineString('s_doctor_http_title'); title.style.cssText = 'margin:0;font:700 24px/1.1 Rajdhani,Bahnschrift,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#fff';
  body.textContent = engineString('s_doctor_http_body'); body.style.margin = '0';
  const button = 'min-height:48px;padding:13px 16px;cursor:pointer;font:700 12px/1 "JetBrains Mono",Menlo,monospace;letter-spacing:.22em;text-transform:uppercase;border:1px solid rgba(143,227,255,.35);background:rgba(13,27,38,.6);color:#e6f2f8';
  retry.type = 'button'; retry.className = 'go'; retry.textContent = engineString('s_doctor_http_retry'); retry.style.cssText = `${button};border-color:#8fe3ff;background:rgba(143,227,255,.18)`;
  back.type = 'button'; back.textContent = engineString('s_doctor_http_back'); back.style.cssText = button;
  summary.textContent = engineString('s_doctor_http_details'); fact.textContent = engineString('s_doctor_http_fact', [measured]); fact.style.cssText = 'margin:8px 0 0;opacity:.6';
  details.append(summary, fact);
  const owner = new Scope('doctor-http', scope), close = (cause: FailureClear): void => { clearFailure(card, cause, owner); if (doctorCardClose === close) doctorCardClose = null; owner.dispose(); card.remove(); };
  showFailure(owner, card, 'doctor-http');
  trapFocus(owner, card);
  doctorCardClose = close;
  owner.listen(retry, 'click', () => { retry.disabled = true; retry.textContent = engineString('s_doctor_http_checking'); void again(); });
  owner.listen(back, 'click', () => { close('dismissed'); });
  box.append(title, body, retry, back, details); card.append(box);
  mountUi(card, owner, document.body);
  retry.focus();
}

/** Leave for the doctor: a held session saves first, and the page's report and the way back go with it. FM8 mode 14: a doctor page
 *  that doesn't answer its preflight leaves this page as it was, with a card saying so. Resolves true when the page leaves. */
export async function openDoctorPage(from: string, read: typeof fetch = fetch): Promise<boolean> {
  const url = doctorUrl(from), failed = await doctorPreflight(url, read);
  if (failed !== null) { doctorHttpCard(failed, () => openDoctorPage(from, read)); return false; }
  const report = diagnosticsSource();
  try {
    // oxlint-disable-next-line wildshard/no-raw-save -- one tab-scoped handoff key the doctor's page reads; that page loads no save service
    sessionStorage.setItem(DOCTOR_EARLIER_KEY, JSON.stringify({ earlier: report === null ? null : report(), back: `${location.pathname}${location.search}`, zone: runningZone() }));
  } catch { /* storage refused: the doctor still runs, its report is just shorter */ }
  leaveSaved(() => { markUnload('doctor'); location.assign(url); });
  return true;
}

// The online page's own module graph (src/client/host/online/shell.ts) asks by event: it can't share this bundle's save hold.
scope.listen(document, 'ws:doctor', event => { void openDoctorPage(event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : 'online'); });

/** Settings ▸ Connection: the doctor for everyone, beside Offline play (the title's Settings and the pause menu's saves). */
export function buildConnectionRow(owner: Scope): HTMLElement {
  const box = document.createElement('div');
  const label = document.createElement('div'); label.className = 'ws-gmenu-label'; label.textContent = engineString('s_doctor_title');
  const note = document.createElement('div'); note.className = 'ws-gmenu-note'; note.textContent = engineString('s_doctor_note');
  const go = document.createElement('button'); go.type = 'button'; go.className = 'ws-gmenu-btn ws-gmenu-doctor'; go.textContent = engineString('s_doctor_open');
  listenTap(owner, go, () => { go.disabled = true; void openDoctorPage('settings').then(left => { go.disabled = left; return left; }); });
  box.append(label, note, go);
  return box;
}


/** The shell survives the disposed level. Text nodes keep raw error messages/stacks safe to display. */
/** The shown failure's wait for the network (SB53): a new screen replaces the old one's. */
let onlineWait: Scope | undefined;

export function showLoadFailure(failure: LoadFailure): HTMLElement {
  {
    document.querySelector('.ws-load-error')?.remove();
    onlineWait?.dispose(); onlineWait = undefined;
    const root = document.createElement('section');
    root.className = 'ws-load-error';
    root.dataset['wsShell'] = 'true';
    root.setAttribute('role', 'alert');
    root.style.cssText = 'position:fixed;inset:0;z-index:calc(var(--ws-layer-error,2147482500) + 1147);box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));background:#0d1b26;color:#e8f5fa;font:16px/1.5 monospace;overflow:auto';
    const heading = document.createElement('h1');
    heading.textContent = engineString('s_114476f37bae', [failure.name]);
    const context = document.createElement('p');
    context.textContent = engineString('s_ac1d8f02f8f2', [failure.build, failure.stage]);
    const message = document.createElement('p');
    message.textContent = failure.message;
    const stack = document.createElement('pre');
    stack.style.cssText = 'flex:1;min-height:100px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #8fe3ff;padding:16px;font:13px/1.5 monospace';
    stack.textContent = failure.stack;
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = engineString('s_8229c4ee6826');
    const button = 'flex:none;min-height:52px;padding:14px 28px;border:1px solid #8fe3ff;color:#e8f5fa;background:#0d1b26;font:inherit;text-transform:uppercase;cursor:pointer;touch-action:manipulation';
    reload.style.cssText = button;
    scope.listen(reload, 'click', () => { showReloading(reload); leaveAfterPaint(() => { markReload('load failure reload'); location.reload(); }); });
    // STAGING-BUGBASH SB53: shown offline, the failure is the network's (a lazy module's fetch, which never loads again in this
    // document): once the network is back the page reloads by itself and goes back into the world (index.html SB44)
    if (!navigator.onLine) {
      const back = new Scope('load-failure-online', scope);
      onlineWait = back;
      back.listen(window, 'online', () => {
        back.dispose(); if (onlineWait === back) onlineWait = undefined;
        // only the screen still on the page reloads (a dismissed or replaced one waits for nothing)
        if (!root.isConnected) return;
        showReloading(reload);
        leaveAfterPaint(() => { markReload('offline load failure', 'background'); location.reload(); });
      });
    }
    // LS4 (J188): this screen covers the loading card, so Copy diagnostics moves here, beside Reload, in flow after the
    // stack: the failure stays on screen and the one Copy stays tappable. The report is the card's own.
    const actions = document.createElement('div');
    actions.style.cssText = 'flex:none;display:flex;flex-wrap:wrap;gap:12px';
    actions.append(reload);
    const read = diagnosticsSource();
    if (read !== null) {
      for (const covered of document.querySelectorAll('.ws-load .ws-load-copy')) covered.remove();
      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'ws-load-copy'; copy.textContent = engineString('s_loading_copy');
      copy.style.cssText = button;
      listenTap(scope, copy, () => {
        void copyText(read()).then(ok => { copy.textContent = engineString(ok ? 's_loading_copied' : 's_loading_copy_failed'); return undefined; });
      });
      actions.append(copy);
    }
    // E7.5 prep (Jake, 2026-11-09): the Connection doctor opens its own page and takes this screen's report with it
    const doctor = document.createElement('button');
    doctor.type = 'button'; doctor.className = 'ws-load-doctor'; doctor.textContent = engineString('s_doctor_failed');
    doctor.style.cssText = button;
    listenTap(scope, doctor, () => { doctor.disabled = true; void openDoctorPage('ls4').then(left => { doctor.disabled = left; return left; }); });
    actions.append(doctor);
    root.append(heading, context, message, stack, actions);
    mountUi(root, scope, document.body);
    app.ui.push('error', { root, order: 1147, back: () => { /* Fatal load failure requires reload. */ } }, scope);
    reload.focus();
    return root;
  }
}
