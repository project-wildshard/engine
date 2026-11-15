// FM6 mode 36 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): "The world didn't download". A page (the plan's first style) over the
// loading card, shown while a read the given-up download fell through to waits on RETRY. Try again is that same RETRY (the existing
// recovery path, no new counter); the downloaded files are kept, so it is quicker. It closes when the wait it belongs to settles.
// Primary copy has no address or status: Details and Copy diagnostics hold them.
import type { Scope } from '../../../shared/engine/app/scope';
import type { DownloadGiveUp } from '../boot/downloadGiveUp';
import { copyText, diagnosticsSource } from './diagnosticsCopy';
import { mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';

const PAGE = 'position:fixed;inset:0;z-index:2147482600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,9,14,.86);color:#e6f2f8;font:12px/1.5 "JetBrains Mono",Menlo,monospace';
const BOX = 'width:min(440px,100%);padding:22px 18px 16px;background:rgba(13,27,38,.92);border:1px solid rgba(255,120,120,.45);border-top:2px solid #ff7878;display:flex;flex-direction:column;gap:10px';
const BUTTON = 'min-height:48px;padding:13px 16px;cursor:pointer;font:700 12px/1 "JetBrains Mono",Menlo,monospace;letter-spacing:.22em;text-transform:uppercase;border:1px solid rgba(143,227,255,.35);background:rgba(13,27,38,.6);color:#e6f2f8';

/** The one page on screen: a second waiting read shares it, and takes it over if the first read's wait ends alone (a cancel). */
let open: Scope | null = null;
const queued: (() => void)[] = [];

/** Show the page for `owner`'s wait (its disposal closes it). `retry` is the card's RETRY; `measured` is the read's own failure. */
export function downloadFailedPage(owner: Scope, given: DownloadGiveUp, measured: string, retry: () => void): void {
  if (open !== null && !open.disposed) {
    const again = (): void => { if (!owner.disposed) downloadFailedPage(owner, given, measured, retry); };
    queued.push(again);
    owner.onDispose(() => { const at = queued.indexOf(again); if (at !== -1) queued.splice(at, 1); });
    return;
  }
  const page = owner.child('download-failed');
  open = page;
  const root = document.createElement('div'), box = document.createElement('div'), tag = document.createElement('p'), title = document.createElement('h1'), body = document.createElement('p');
  const again = document.createElement('button'), check = document.createElement('button'), copy = document.createElement('button');
  const details = document.createElement('details'), summary = document.createElement('summary'), fact = document.createElement('p');
  root.dataset['failmode'] = 'download-failed'; root.dataset['tone'] = 'bad'; root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', engineString('s_download_failed_title')); root.style.cssText = PAGE; box.style.cssText = BOX;
  tag.textContent = engineString('s_download_failed_tag'); tag.style.cssText = 'margin:0;font-size:10.5px;letter-spacing:.3em;text-transform:uppercase;color:#ff9a9a';
  title.textContent = engineString('s_download_failed_title'); title.style.cssText = 'margin:0;font:700 24px/1.1 Rajdhani,Bahnschrift,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#fff';
  body.textContent = engineString('s_download_failed_body', [given.attempts]);
  body.style.margin = '0';
  again.type = 'button'; again.className = 'go'; again.textContent = engineString('s_download_failed_retry'); again.style.cssText = `${BUTTON};border-color:#8fe3ff;background:rgba(143,227,255,.18)`;
  check.type = 'button'; check.textContent = engineString('s_download_failed_check'); check.style.cssText = BUTTON;
  copy.type = 'button'; copy.textContent = engineString('s_download_failed_copy'); copy.style.cssText = BUTTON;
  const said = `${given.detail}${given.status === null ? ' · no HTTP response' : ` · HTTP ${String(given.status)}`} × ${String(given.attempts)}; then ${measured}`;
  summary.textContent = engineString('s_download_failed_details'); fact.textContent = said; fact.style.cssText = 'margin:8px 0 0;opacity:.6;overflow-wrap:anywhere';
  details.append(summary, fact);
  page.listen(again, 'click', () => { again.disabled = true; again.textContent = engineString('s_download_failed_trying'); retry(); });
  page.listen(check, 'click', () => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: 'download-failed' })); });
  page.listen(copy, 'click', () => {
    const report = diagnosticsSource();
    void (async () => { copy.textContent = await copyText(`${said}\n\n${report === null ? '' : report()}`) ? engineString('s_download_failed_copied') : engineString('s_download_failed_refused'); })();
  });
  page.onDispose(() => { root.remove(); if (open === page) open = null; queued.shift()?.(); });
  box.append(tag, title, body, again, check, copy, details); root.append(box);
  mountUi(root, page, document.body);
  again.focus();
}
