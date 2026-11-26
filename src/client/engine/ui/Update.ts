import { Scope } from '../../../shared/engine/app/scope';
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
import { reloadForPlayer } from './playerReload';
import { buildLabel, checkLiveBuild, compactBuildLabel, liveBuildOf, shortBuild } from './buildCheck';


// The update pill exists before content is selected; keep App and Three out of the entry graph.
const scope = new Scope('ui.Update');

declare const __BUILD_ID__: string;

/** "v0.1.5 · a8144a5" (Jake, 2026-11-10: the engine version and the short commit) */
const runningLabel = buildLabel(__BUILD_ID__);
/** a phone's title has room beside the logo for the label alone; " · reload" joins it on a wider screen (the 700 px phone rule of update.css) */
const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 700px)') : null;
const el = document.createElement('button');
el.className = 'ws-update';
el.type = 'button';
el.innerHTML = engineString('s_85c05389552b');
hudSlots.widget('band.1', el, 0, scope, document.body);

let busy = false;
let newer = false;
/** The pill's tap: one tap reloads (RL2), with the loading pill and the RELOADING cover in the tap's own turn (RL3,
 *  src/client/engine/ui/playerReload.ts, which Settings ▸ Build shares). `busy` keeps the pointerup / click pair from
 *  running twice and the pill's words from repainting under the spinner. */
function reload(): void {
  if (busy) return;
  busy = true;
  reloadForPlayer(el, { newer });
}
// pointerup as well as click: iOS drops the synthesized click when a tap jitters (index.html cancels touchmove for the
// rubber-band), so the pill answers the lift itself; `busy` keeps the pair from running twice
scope.listen(el, 'pointerup', reload);
scope.listen(el, 'click', reload);
// a bfcache return: the cover module put the pill back; the pill answers taps again
scope.listen(window, 'pageshow', event => { if (event.persisted) busy = false; });

let newLabel = '';
/** row 50: /version.json last said a build other than this page's is live */
let liveNewer = false;
/** FM5 mode 13: the last check failed (its status), until a check answers. Only a developer is told (decision 5: play is not
 *  affected); the status rides the pill's title, not its words, and the words count down to the next 5-minute poll. */
let checkFailed: { status: number | null } | null = null;
const POLL_MS = 5 * 60 * 1000, pollFrom = Date.now();
/** the pill's words: a player reads "New version", a developer the build ids */
function paint(): void {
  const text = el.querySelector('[data-el="text"]');
  if (!text || busy) return;
  const failing = !newer && checkFailed !== null && isDev();
  el.classList.toggle('failed', failing);
  if (failing) {
    const nextMin = Math.max(1, Math.ceil((POLL_MS - (Date.now() - pollFrom) % POLL_MS) / 60_000));
    el.dataset['failmode'] = 'version-http'; el.title = `version.json ${checkFailed?.status === null || checkFailed === null ? 'no answer' : `HTTP ${String(checkFailed.status)}`}`;
    text.textContent = engineString('s_update_check_failed_dev', [String(nextMin)]);
    return;
  }
  if (el.dataset['failmode'] !== undefined) { delete el.dataset['failmode']; el.title = ''; }
  text.textContent = !newer ? (narrow?.matches === true ? compactBuildLabel(runningLabel) : engineString('s_9e4fe13a912d', [runningLabel])) : isDev()
    ? engineString('s_update_next_boundary_dev', [newLabel]) : engineString('s_old_tab_update_available'); // PV11: "Update available", never blocking play
}
scope.listen(window, 'ws-live-build-failed', event => {
  const value: unknown = event instanceof CustomEvent ? event.detail : null;
  checkFailed = { status: typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'number' ? value.status : null };
  paint();
});
// the failed line's countdown moves with the clock while it shows
scope.interval(60_000, () => { if (checkFailed !== null) paint(); });
const lightUp = (label: string): void => {
  newer = true;
  newLabel = label;
  el.classList.add('newer');
  paint();
  sync();
};
function dim(): void { newer = false; newLabel = ''; el.classList.remove('newer'); paint(); sync(); }
paint();
if (narrow !== null) scope.listen(narrow, 'change', paint);
// the worker found a new build (installed, waiting) — same pill, no toast
scope.listen(window, 'ws-sw-waiting', event => {
  if (!(event instanceof CustomEvent)) return;
  const value: unknown = event.detail;
  if (typeof value !== 'object' || value === null || !('waiting' in value)) return;
  if (value.waiting === null) { if (!liveNewer) dim(); }
  else if ('build' in value && typeof value.build === 'string') lightUp(shortBuild(value.build));
});

const check = (): Promise<unknown> => checkLiveBuild();
// any read of /version.json (this pill's, or Settings ▸ Build's Check) lights the pill when another build is live, on a page a
// worker controls too (QA 11-19 row 50: Jake's home-screen app waited on the new worker's whole generation download, which
// iOS kept from finishing, and never lit). The tap adopts an installed worker when there is one; otherwise it reloads, and
// the controlling worker, told the live build (boot/sw.ts LIVE), answers that reload with the network's new page.
scope.listen(window, 'ws-live-build', event => {
  const build = liveBuildOf(event);
  if (build !== null && checkFailed !== null) { checkFailed = null; paint(); }
  if (build === null) return;
  liveNewer = build !== __BUILD_ID__;
  if (liveNewer) lightUp(shortBuild(build));
  else dim();
});
void check();
scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
// row 50: a page restored from the bfcache is a foreground too
scope.listen(window, 'pageshow', event => { if (event.persisted) void check(); });
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
