import { pageScope } from '../../../shared/engine/app/resources';
import { engineString } from '../../../shared/engine/strings';
/**
 * RL3 (Jake, 2026-11-09: "i press it i get no feedback", "U need that button to turn into a loading button if it works",
 * "I need the full page loading modal. Like reloading."): a reload the player asked for answers in the tap's own turn,
 * before any save, await or service-worker message. The tapped control turns into a disabled loading button (a second
 * tap does nothing) and a full-page RELOADING cover goes over everything, the title's hero included.
 *
 *   showReloading(button)          // first line of the tap handler; then save / adopt / navigate as before
 *   reloadingLine(text, 'slow')    // the honest line under the word, e.g. at the hard-reload fallback
 *
 * Nothing takes the cover down: the page unloading does. A bfcache return (pageshow persisted) is the one way back to
 * this document, and it restores the control and drops the cover. Styled inline (abyss navy, cyan, Rajdhani) so it
 * paints even before the title's stylesheets have loaded; the spinners turn with the Web Animations API for the same reason.
 */

/** How long a reload waits on the service-worker hand-over before it reloads hard (Jake: "it should just reload"). */
export const RELOAD_FALLBACK_MS = 3000;

// the top z-index there is: the load failure screen sits at --ws-layer-error + 1147 (2147483647); appended last, this wins the tie
const COVER = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;'
  + 'box-sizing:border-box;padding:0 28px;text-align:center;background:rgba(5,8,16,0.86);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);'
  + 'pointer-events:auto;touch-action:none;color:#e6f2f8;-webkit-user-select:none;user-select:none';
const RING = 'width:64px;height:64px;box-sizing:border-box;border-radius:50%;border:4px solid rgba(143,227,255,0.18);border-top-color:#8fe3ff;'
  + 'box-shadow:0 0 24px rgba(143,227,255,0.25)';
const WORD = "font:700 30px/1 var(--ws-display,'Rajdhani','Bahnschrift','DIN Alternate',sans-serif);letter-spacing:0.22em;text-indent:0.22em;"
  + 'text-transform:uppercase;color:#eaf8ff;text-shadow:0 0 16px rgba(143,227,255,0.5)';
const LINE = "max-width:300px;min-height:1.5em;font:11px/1.5 var(--ws-mono,'SF Mono',Menlo,monospace);letter-spacing:0.06em";
const MINI = 'display:inline-block;flex:none;width:10px;height:10px;margin-right:6px;box-sizing:border-box;border-radius:50%;'
  + 'border:2px solid currentColor;border-top-color:transparent;vertical-align:-1px';
const LINE_COLOR = { plain: 'rgba(196,220,232,0.75)', slow: '#ffb547' } as const;

function turn(el: HTMLElement, ms: number): void {
  if (typeof el.animate === 'function') el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: ms, iterations: Infinity });
}

let cover: HTMLElement | null = null;
let words: HTMLElement | null = null;
let restore: (() => void)[] = [];
let watching = false;

// RL8: code that must not pull this module into its graph (boot's stale-build reload) asks by event, in its own turn.
// Guarded: node-side importers (debug/probe.ts through debugOptions.ts) load this module with no document.
if (typeof document !== 'undefined') {
  pageScope.listen(document, 'ws:reloading', event => { showReloading(null, event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : ''); });
}

/** The tapped control as a loading button: disabled, busy, a spinner and "Reloading". */
function loadingButton(control: HTMLElement): void {
  const children = [...control.childNodes], button = control instanceof HTMLButtonElement ? control : null, wasDisabled = button?.disabled ?? false;
  if (button !== null) button.disabled = true;
  control.setAttribute('aria-busy', 'true');
  control.dataset['reloading'] = '';
  const ring = document.createElement('span'), label = document.createElement('span');
  ring.style.cssText = MINI; ring.setAttribute('aria-hidden', 'true'); turn(ring, 700);
  label.textContent = engineString('s_reloading');
  control.replaceChildren(ring, label);
  restore.push(() => {
    control.replaceChildren(...children);
    if (button !== null) button.disabled = wasDisabled;
    control.removeAttribute('aria-busy'); delete control.dataset['reloading'];
  });
}

/** Show the loading button and the full-page RELOADING cover, now (the caller's tap turn). Safe to call again. */
export function showReloading(control?: HTMLElement | null, line = '', parent: HTMLElement = document.body): void {
  if (control !== null && control !== undefined && !('reloading' in control.dataset)) loadingButton(control);
  if (cover === null) {
    cover = document.createElement('div');
    cover.id = 'ws-reloading';
    cover.setAttribute('role', 'status'); cover.setAttribute('aria-live', 'assertive');
    cover.style.cssText = COVER;
    const ring = document.createElement('div'), word = document.createElement('b');
    ring.style.cssText = RING; ring.setAttribute('aria-hidden', 'true'); turn(ring, 800);
    word.style.cssText = WORD; word.textContent = engineString('s_reloading');
    words = document.createElement('small');
    cover.append(ring, word, words);
    // a tap that lands on the cover goes nowhere: what is under it is leaving
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart'] as const) pageScope.listen(cover, type, event => { event.stopPropagation(); }, { passive: true });
    pageScope.ownNode(cover);
  }
  if (!cover.isConnected) parent.append(cover);
  reloadingLine(line);
  if (!watching) {
    watching = true;
    pageScope.listen(window, 'pageshow', event => { if (event.persisted) hideReloading(); });
  }
}

/** The line under RELOADING; `slow` paints it amber (the hard-reload fallback). */
export function reloadingLine(text: string, tone: keyof typeof LINE_COLOR = 'plain'): void {
  if (words === null) return;
  words.style.cssText = `${LINE};color:${LINE_COLOR[tone]}`;
  words.textContent = text;
}

/** iOS Simulator, 2026-11-09: WebKit stops painting a page as soon as a navigation starts in the same turn, so the load
 * failure screen's RELOAD showed no cover at all. Navigate one painted frame after showReloading; a page that gets no
 * frames (hidden) goes after LEAVE_FRAME_MS anyway. */
const LEAVE_FRAME_MS = 100;
export function leaveAfterPaint(go: () => void): void {
  let gone = false;
  const once = (): void => { if (gone) return; gone = true; go(); };
  pageScope.raf(() => { pageScope.timeout(0, once); });
  pageScope.timeout(LEAVE_FRAME_MS, once);
}

/** Whether a reload is on screen (tests, and callers that must not start a second one). */
export function reloadingShown(): boolean { return cover?.isConnected === true; }

/** Only a document that comes back (bfcache) drops the cover; exported for that and for tests. */
export function hideReloading(): void {
  cover?.remove();
  const undo = restore; restore = [];
  for (const run of undo) run();
}
