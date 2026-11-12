import { pageScope } from '../../../shared/engine/app/resources';
/**
 * viewport — the page's drawable height.
 *
 *   installViewport();            // once (Game's constructor); keeps `--ws-vh` on <html> current on every resize
 *   const h = viewportHeight();   // use instead of window.innerHeight for the canvas and anything projected onto it
 *
 * History (E46 → E58): an iOS home-screen web app laid out UNDER the status bar (`viewport-fit=cover` + black-translucent)
 * had WebKit shrink the viewport a status bar short (~62 px) about a second after load, and keep it short; the black strip
 * sat under the control bar and the title. E46 papered over it here by sizing to `screen.height`, but WebKit clips fixed
 * content to the shrunk viewport, so the strip stayed (and the bar was cut). Bisected in the iOS 26.5 simulator's
 * home-screen app (E58): `overflow: hidden` on html / body and the boot loader's relayout both trigger the shrink, and only
 * dropping `viewport-fit=cover` (the page starts below the status bar and runs to the bottom edge) cures it for good. So
 * this is plain innerHeight again; the module stays as the one place to change should WebKit need another workaround.
 */
/** The game's height while a keyboard is up (MK3, below); null without one. */
let fitted: number | null = null;
export function viewportHeight(): number {
  return fitted ?? window.innerHeight;
}

/**
 * MOBILE-KEYBOARD MK1+MK3 (meta, J297; Jake, 2026-11-12 17:44 Cancún: "detect when the keyboard is open … fit the rest of the
 * game in the remaining pixels"). iOS Safari never shrinks the layout viewport (innerHeight, 100dvh) for its keyboard, nor
 * supports `interactive-widget` or `env(keyboard-inset-*)`: only `visualViewport` shrinks, and Safari may pan the page
 * (`offsetTop`). While a keyboard is up the page carries `data-ws-keyboard` on <html>, `--ws-kb-top` / `--ws-kb-bottom` (the
 * visible band, layout px) and `--ws-vh` the game's fitted height; #game and #hud move to the band's top (base.css), the touch
 * controls hide (touch.css) and an open chat docks on the keyboard (chatLines.ts). The chat says how much of the band it takes
 * with `data-ws-kb-reserve` on <html> (a mark, as chatLines is outside the game's bundle).
 */
export interface ViewSample { readonly layoutHeight: number; readonly viewHeight: number; readonly viewTop: number; readonly scale: number; readonly reserve: number }
export interface KeyboardFit { readonly open: boolean; readonly top: number; readonly bottom: number; readonly gameHeight: number }
/** Less hidden than this is the URL bar or a safe area, not a keyboard (the smallest iPhone keyboard is ~260 pt). */
export const KEYBOARD_MIN_PX = 120;
/** The least the game keeps, so a landscape phone with the chat docked still draws a strip of world. */
const MIN_GAME_PX = 80;
export function keyboardFit(sample: ViewSample): KeyboardFit {
  const { layoutHeight, viewHeight, viewTop, scale, reserve } = sample;
  // a pinch zoom shrinks the visual viewport too; the game's page doesn't zoom, but a stuck zoom is not a keyboard
  if (scale > 1.01 || layoutHeight - viewHeight < KEYBOARD_MIN_PX) return { open: false, top: 0, bottom: layoutHeight, gameHeight: layoutHeight };
  const top = Math.max(0, Math.round(viewTop)), bottom = Math.round(viewTop + viewHeight);
  return { open: true, top, bottom, gameHeight: Math.max(MIN_GAME_PX, bottom - top - Math.max(0, reserve)) };
}

let lastFit = '';
/** The page's full height at this width. iOS 26 Safari shrinks innerHeight for the keyboard too (Simulator, iPhone 17 Pro: 714
 *  → 501 while visualViewport is 377 tall and the page scrolled 213), so the keyboard is measured against the tallest page seen
 *  at this width, not the current innerHeight. A rotation (a new width) starts again. */
const tallest = new Map<number, number>();
/** A field a phone's keyboard opens for. Only while one has focus can a short visual viewport be a keyboard: a desktop
 *  window losing height (devtools, a dragged edge) never is (claude -p review MUST). */
function typing(): boolean {
  const field = document.activeElement;
  if (field instanceof HTMLTextAreaElement) return true;
  if (field instanceof HTMLInputElement) return !['button', 'checkbox', 'color', 'file', 'radio', 'range', 'reset', 'submit'].includes(field.type);
  return field instanceof HTMLElement && field.isContentEditable;
}
let lastHeight: number | null = null;
/** What `syncKeyboardView` reads of `visualViewport`. */
export interface ViewLike { readonly height: number; readonly offsetTop: number; readonly scale: number }
/** Read the keyboard and mark the page. Returns whether the fit changed; the game's own resize then runs (a window resize
 *  event), so the canvas, camera and composer take the fitted height once per open and once per close. `heard`: this look comes
 *  from a window resize, which the game hears itself. */
export function syncKeyboardView(view: ViewLike | null | undefined, heard = false): boolean {
  const root = document.documentElement;
  const reserve = Number(root.dataset['wsKbReserve'] ?? 0);
  // per width, so a rotation with the keyboard up (and back) still knows the full page (review SHOULD)
  const full = Math.max(tallest.get(window.innerWidth) ?? 0, window.innerHeight);
  tallest.set(window.innerWidth, full);
  const fit = view === null || view === undefined || !typing() ? null : keyboardFit({ layoutHeight: full, viewHeight: view.height, viewTop: view.offsetTop, scale: view.scale, reserve: Number.isFinite(reserve) ? reserve : 0 });
  const open = fit?.open === true;
  const key = open ? `${String(fit.top)}:${String(fit.bottom)}:${String(fit.gameHeight)}` : '';
  const changed = key !== lastFit, wasOpen = lastFit !== '';
  if (changed) {
    lastFit = key;
    fitted = open ? fit.gameHeight : null;
    root.toggleAttribute('data-ws-keyboard', open);
    if (open) { root.style.setProperty('--ws-kb-top', `${String(fit.top)}px`); root.style.setProperty('--ws-kb-bottom', `${String(fit.bottom)}px`); }
    else { root.style.removeProperty('--ws-kb-top'); root.style.removeProperty('--ws-kb-bottom'); }
    // iOS can leave the page panned after the keyboard closes; the game is back at top 0, so the page must be too
    if (wasOpen && !open && (window.scrollY !== 0 || window.scrollX !== 0)) window.scrollTo(0, 0);
  }
  // --ws-vh is written on every look: iOS 26 restores innerHeight after the focus leaves, and the last word must be current
  const height = viewportHeight(), px = `${String(height)}px`;
  if (root.style.getPropertyValue('--ws-vh') !== px) root.style.setProperty('--ws-vh', px);
  // the first look: the game sized itself as it started, so only a keyboard opening on it moves anything (review SHOULD)
  const moved = lastHeight === null ? changed : height !== lastHeight;
  lastHeight = height;
  // the game's resize (renderer, composer, shadows) runs only when its height moved: a pan as the caret moves only moves the
  // band, and a window resize already reached the game unless the keyboard changed with it. MK5 (iOS 26 Simulator, the real
  // game): after Done, innerHeight comes back 503 -> 714 ~450 ms after the focus left, with a visualViewport resize and no
  // window resize, so a look that is not a window resize tells the game whenever the height moved
  if (moved && (changed || !heard)) window.dispatchEvent(new Event('resize'));
  return changed;
}

/** A second look after a rotation or a close, once iOS has settled its viewport (the research's ~120 ms, with margin). */
const SETTLE_MS = 150;
let installed = false;
/** publish the height as `--ws-vh` (base.css sizes #game and #hud with it) and keep it current */
export function installViewport(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  const sync = (): void => {
    root.style.setProperty('--ws-vh', `${viewportHeight()}px`);
    // below the status bar WebKit reports safe-area-inset-bottom 0, yet the home indicator still sits over the page's bottom
    // edge on Face ID phones (portrait screen ≥ 812 px tall): --ws-home stands in for it (touch.css lifts the bar's content)
    const standalone = root.classList.contains('standalone'), tall = Math.max(screen.width, screen.height) >= 812;
    root.style.setProperty('--ws-home', standalone && tall ? '34px' : '0px');
  };
  sync();
  pageScope.listen(window, 'resize', sync);
  // MK1: the keyboard shows only in visualViewport (resize as it opens or closes, scroll as Safari pans), and the open chat's
  // reserve comes as a mark on <html>
  const view = window.visualViewport;
  if (view === null || view === undefined) return;
  const keyboard = (): void => { syncKeyboardView(view); };
  pageScope.listen(view, 'resize', keyboard);
  pageScope.listen(view, 'scroll', keyboard);
  // a rotation with the keyboard up changes the layout height too (the game hears this one itself); WebKit 297779 can report a
  // wrong visualViewport mid-rotation, so look again once it has settled
  pageScope.listen(window, 'resize', event => { if (event.isTrusted) { syncKeyboardView(view, true); pageScope.timeout(SETTLE_MS, keyboard); } });
  // a field taking or leaving focus (focusout's new focus settles after the event)
  pageScope.listen(document, 'focusin', keyboard);
  pageScope.listen(document, 'focusout', () => { pageScope.timeout(0, keyboard); pageScope.timeout(SETTLE_MS, keyboard); });
  const marks = new MutationObserver(keyboard);
  marks.observe(root, { attributes: true, attributeFilter: ['data-ws-kb-reserve'] });
  pageScope.onDispose(() => { marks.disconnect(); });
}
