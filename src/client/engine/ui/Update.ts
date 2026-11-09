import { Scope } from '../../../shared/engine/app/scope';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { hudSlots } from './hudSlots';
import { engineString } from '../../../shared/engine/strings';
/**
 * Build pill on the title screen: shows the running build and reloads on tap.
 * Bookmarked as a home-screen PWA on iOS there is no address bar, so this is the only
 * way to pull a new deploy. It also polls /version.json (no-store) on load and whenever
 * the app returns to the foreground; when the server has a newer build the pill lights up.
 *
 * E140 (the user's 6a): players see the pill only when a new build is waiting ("New version · tap to update"). Developer
 * mode (src/client/engine/core/devMode.ts) shows it always, with the build id ("f86b4c3 · reload", "new f86b4c3 · tap to update").
 *
 * E176 (Jake): the in-game PAUSE menu carries it too, at the same screen corner as the title's — on the phone the pause
 * menu is the only chrome you can reach once you are in the world, so that is where a waiting deploy has to be tappable.
 * One tap reloads wherever the pill is (RL3, Jake 2026-11-09: "i sometimes see confirm reload"; G877's arm-then-confirm is gone).
 * It sits over the menu overlay (z 80 vs 70) and publishes `--ws-pill` on <html>, which is the band gmenu.css keeps free
 * above the sheet so the pill never lands on CLOSE.
 */
import { isDev, onDev } from '../core/devMode';
import { leaveSaved, markReload } from '../boot/lastEnd';
import { RELOAD_FALLBACK_MS, reloadingLine, showReloading } from './reloadCover';


// The update pill exists before content is selected; keep App and Three out of the entry graph.
const scope = new Scope('ui.Update');

declare const __BUILD_ID__: string;

/** `<sha>-<stamp>` → the sha, or the time token: Vercel CLI builds have no git checkout */
const shortBuild = (id: string): string => { const [gitSha = '', stamp = ''] = id.split('-'); return gitSha.length >= 7 ? gitSha : stamp; };
const sha = shortBuild(__BUILD_ID__);
const el = document.createElement('button');
el.className = 'ws-update';
el.type = 'button';
el.innerHTML = engineString('s_85c05389552b');
hudSlots.widget('band.1', el, 0, scope, document.body);

let busy = false;
let newer = false;
/** RL2 (RELOAD = reload): the pill's tap reloads; the title loads a fresh `/`, anywhere else the page reloads where it is.
 *  RL3 (Jake 2026-11-09: "i press it i get no feedback", "I need the full page loading modal"): the tap's own turn turns
 *  the pill into a loading button and puts the full-page RELOADING cover up (src/client/engine/ui/reloadCover.ts), before
 *  the save, the worker or anything else is awaited. The cover stays until the page unloads.
 *  QC3: a waiting worker is activated first (SKIP_WAITING, then its `activated` state) so the next document is the new
 *  build's and the pill goes dark. RL3: that hand-over gets RELOAD_FALLBACK_MS; past it the page reloads hard and the
 *  cover says so. Nothing to adopt (no worker, or it retired) is a plain reload. */
function reload(): void {
  if (busy) return;
  busy = true;
  const tapped = diagnosticNow();
  showReloading(el, newer ? engineString('s_reloading_update') : '');
  const title = titleBoundary(), sw = window.__ws_sw;
  let gone = false;
  const plain = (): void => {
    if (gone) return;
    gone = true;
    if (title) { markReload('update at title'); location.replace('/'); }
    else { markReload('update tapped'); location.reload(); }
  };
  if (sw === undefined) { leaveSaved(plain); return; }
  leaveSaved(() => {
    // the budget runs from the tap: a save that took time leaves the hand-over only what is left of RELOAD_FALLBACK_MS
    const left = Math.round(RELOAD_FALLBACK_MS - (diagnosticNow() - tapped));
    // the hand-over ran out of time (not merely "nothing to adopt"): say so, in amber, on the way out
    const hard = (): void => { if (diagnosticNow() - tapped >= RELOAD_FALLBACK_MS - 50) reloadingLine(engineString('s_reloading_slow'), 'slow'); plain(); };
    if (left <= 0) { hard(); return; }
    void sw.adopt(title ? '/' : undefined, title ? 'update at title' : 'update tapped', left)
      .then(sent => { if (sent) gone = true; else hard(); return undefined; }, hard);
  });
}
// pointerup as well as click: iOS drops the synthesized click when a tap jitters (index.html cancels touchmove for the
// rubber-band), so the pill answers the lift itself; `busy` keeps the pair from running twice
scope.listen(el, 'pointerup', reload);
scope.listen(el, 'click', reload);
// a bfcache return: the cover module put the pill back; the pill answers taps again
scope.listen(window, 'pageshow', event => { if (event.persisted) busy = false; });

let newLabel = '';
function titleBoundary(): boolean {
  return document.querySelector('#hud.intro .ws-menu:not(.hide), #hud.intro .ws-main:not(.hide)') !== null;
}
/** the pill's words: a player reads "New version", a developer the build ids */
function paint(): void {
  const text = el.querySelector('[data-el="text"]');
  if (!text || busy) return;
  text.textContent = !newer ? engineString('s_9e4fe13a912d', [sha]) : isDev()
    ? engineString('s_update_next_boundary_dev', [newLabel]) : engineString('s_update_next_boundary');
}
const lightUp = (label: string): void => {
  newer = true;
  newLabel = label;
  el.classList.add('newer');
  paint();
  sync();
};
function dim(): void { newer = false; newLabel = ''; el.classList.remove('newer'); paint(); sync(); }
paint();
// the worker found a new build (installed, waiting) — same pill, no toast
scope.listen(window, 'ws-sw-waiting', event => {
  if (!(event instanceof CustomEvent)) return;
  const value: unknown = event.detail;
  if (typeof value !== 'object' || value === null || !('waiting' in value)) return;
  if (value.waiting === null) dim();
  else if ('build' in value && typeof value.build === 'string') lightUp(shortBuild(value.build));
});

let discovery = 0;
async function check(): Promise<void> {
  if (!navigator.onLine) return; // offline (the PWA plays from its cache): no request that can only fail
  const started = ++discovery;
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j: unknown = await r.json();
    if (started !== discovery) return;
    if (typeof j === 'object' && j !== null && 'build' in j && typeof j.build === 'string' && j.build !== '') {
      if (navigator.serviceWorker?.controller && window.__ws_sw?.enabled !== false) {
        window.dispatchEvent(new CustomEvent('ws-sw-discovered', { detail: { build: j.build } }));
      } else if (j.build !== __BUILD_ID__) lightUp(shortBuild(j.build));
      else dim();
    }
  } catch { /* offline — keep the plain reload pill */ }
}
void check();
scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
scope.interval(5 * 60 * 1000, () => { void check(); });

// Only show while on the loading / title screen; hide once the player has entered the chunk. Players: only when a new build waits.
// The running shard's #hud (E155: each resident shard has its own; a switch swaps them in <body>, which runs sync below)
let hud: HTMLElement | null = null;
const hudClass = new MutationObserver(() => { sync(); });
function sync(): void {
  const now = document.getElementById('hud');
  if (now !== hud) { hudClass.disconnect(); hud = now; if (hud) hudClass.observe(hud, { attributes: true, attributeFilter: ['class'] }); }
  const onTitle = document.querySelector('.ws-load') !== null || (hud?.classList.contains('intro') ?? false);
  const onPause = document.querySelector('.ws-gmenu.show.pause') !== null; // E176: the in-game pause menu (src/client/engine/ui/Menu.ts)
  const show = onTitle || onPause; // Jake 2026-10-01: everyone gets the reload pill on the title and pause menus, not only developer mode
  el.classList.toggle('visible', show); // menu-only: never over the game view, even when a newer build exists
  // the band the menu overlay keeps free above its sheet (gmenu.css) — only while the pill is actually up
  document.documentElement.style.setProperty('--ws-pill', show ? '24px' : '0px');
}
sync();
onDev(() => { paint(); sync(); });
// the pause menu opened or closed: it says so, because its class lives on an element this module never sees created
scope.listen(window, 'ws-menu', () => { sync(); });
const bodyClass = new MutationObserver(sync);
bodyClass.observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
scope.onDispose(() => { hudClass.disconnect(); bodyClass.disconnect(); });
