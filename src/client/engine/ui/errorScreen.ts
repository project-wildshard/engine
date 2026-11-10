import { leaveSaved, markReload, markUnload } from '../boot/lastEnd';
import { showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';
import { engineString } from '../../../shared/engine/strings';
import type { LoadFailure } from '../core/errorReport';
import { app } from '../app/runtime';
import { uiScope, mountUi } from './ownership';
import { listenTap } from '../input/dom';
import { copyText, diagnosticsSource, DOCTOR_EARLIER_KEY } from './diagnosticsCopy';
import type { Scope } from '../../../shared/engine/app/scope';

const scope = uiScope('loadFailure', app.engineScope);

/*
 * E7.5 prep (Jake, 2026-11-09): the way into the Connection doctor, beside the failure screen that offers it. The doctor is its
 * own small page (`doctor/index.html`), so it opens even when this page's worker, packs or renderer are what broke. `?sw=0`
 * takes the navigation past the service worker, which answers every other navigation with the game's document. The page's
 * Copy diagnostics report (LS4), when there is one, rides along in sessionStorage so the doctor's Copy report carries both.
 */
/** A build stamped with a world (`WILDSHARD_RELEASE_URL`): only these show the title's Check connection. */
export function hasOnlineWorld(): boolean { return (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined; }

/** The doctor's address from this page: where it came from, and the cell it was loading. */
export function doctorUrl(from: string, at: Location = location): string {
  const url = new URL('/doctor/', at.origin), here = new URLSearchParams(at.search), chunk = here.get('chunk');
  url.searchParams.set('sw', '0'); url.searchParams.set('from', from);
  if (chunk !== null) url.searchParams.set('chunk', chunk);
  return url.href;
}

/** Leave for the doctor: a held session saves first, and the page's report and the way back go with it. */
export function openDoctorPage(from: string): void {
  const read = diagnosticsSource();
  try {
    // oxlint-disable-next-line wildshard/no-raw-save -- one tab-scoped handoff key the doctor's page reads; that page loads no save service
    sessionStorage.setItem(DOCTOR_EARLIER_KEY, JSON.stringify({ earlier: read === null ? null : read(), back: `${location.pathname}${location.search}` }));
  } catch { /* storage refused: the doctor still runs, its report is just shorter */ }
  const url = doctorUrl(from);
  leaveSaved(() => { markUnload('doctor'); location.assign(url); });
}

// The online page's own module graph (src/client/host/online/shell.ts) asks by event: it can't share this bundle's save hold.
scope.listen(document, 'ws:doctor', event => { openDoctorPage(event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : 'online'); });

/** Settings ▸ Connection: the doctor for everyone, beside Offline play (the title's Settings and the pause menu's saves). */
export function buildConnectionRow(owner: Scope): HTMLElement {
  const box = document.createElement('div');
  const label = document.createElement('div'); label.className = 'ws-gmenu-label'; label.textContent = engineString('s_doctor_title');
  const note = document.createElement('div'); note.className = 'ws-gmenu-note'; note.textContent = engineString('s_doctor_note');
  const go = document.createElement('button'); go.type = 'button'; go.className = 'ws-gmenu-btn ws-gmenu-doctor'; go.textContent = engineString('s_doctor_open');
  listenTap(owner, go, () => { go.disabled = true; openDoctorPage('settings'); });
  box.append(label, note, go);
  return box;
}


/** The shell survives the disposed level. Text nodes keep raw error messages/stacks safe to display. */
export function showLoadFailure(failure: LoadFailure): HTMLElement {
  {
    document.querySelector('.ws-load-error')?.remove();
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
    listenTap(scope, doctor, () => { doctor.disabled = true; openDoctorPage('ls4'); });
    actions.append(doctor);
    root.append(heading, context, message, stack, actions);
    mountUi(root, scope, document.body);
    app.ui.push('error', { root, order: 1147, back: () => { /* Fatal load failure requires reload. */ } }, scope);
    reload.focus();
    return root;
  }
}
