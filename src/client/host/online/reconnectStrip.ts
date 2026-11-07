import type { Scope } from '@wildshard/engine/app/scope';
import type { LinkState } from '@wildshard/engine/net/redial';
import type { Countdown } from '@wildshard/engine/net/socketFrames';

const WORDS: Readonly<Record<LinkState, string>> = { live: '', reconnecting: 'Reconnecting', resuming: 'Resuming', lost: 'Connection lost', full: 'World is full', ended: '' };
const STYLE = 'position:fixed;top:env(safe-area-inset-top,0);left:0;right:0;z-index:1000;display:flex;gap:12px;align-items:center;justify-content:center;padding:6px 12px;font:600 14px/1.4 system-ui,sans-serif;color:#fff;background:rgba(20,20,24,.82);pointer-events:none';

/** E7.1: the line that tells a player the link is down. Returns what to call when it changes. It takes no input but its one button. */
export function reconnectStrip(scope: Scope, retry: () => void, parent: HTMLElement = document.body): (state: LinkState) => void {
  const strip = scope.ownNode(document.createElement('div')), words = document.createElement('span'), again = document.createElement('button');
  strip.id = 'ws-reconnect-strip'; strip.setAttribute('role', 'status'); strip.style.cssText = STYLE; strip.hidden = true; strip.style.display = 'none';
  again.textContent = 'Try again'; again.style.pointerEvents = 'auto'; again.hidden = true;
  scope.listen(again, 'click', retry);
  strip.append(words, again); parent.append(strip);
  return state => {
    const shown = WORDS[state] !== '';
    words.textContent = WORDS[state]; again.hidden = state !== 'lost';
    strip.hidden = !shown; strip.style.display = shown ? 'flex' : 'none';
  };
}

/** How often a stale tab asks again for a build to reload into, in ms. */
const NEW_BUILD_RETRY_MS = 5000;
const NEW_BUILD = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;padding:24px;font:600 16px/1.4 system-ui,sans-serif;color:#fff;text-align:center;background:rgba(5,10,18,.86)';
const NEW_BUILD_BUTTON = 'min-height:44px;padding:8px 32px;border:1px solid #8fe3ff;border-radius:8px;background:#0e2438;color:#8fe3ff;font:inherit';

/** J174: a stale tab with nothing to reload into yet, as when the server moves before the page's origin does. Nothing broke, so it says so. It asks again by itself, and its button goes past this tab's worker. */
export function newBuildPanel(scope: Scope, again: () => Promise<boolean>, reload: () => void, parent: HTMLElement = document.body): void {
  if (document.getElementById('ws-new-build') !== null) return;
  const panel = scope.ownNode(document.createElement('div')), words = document.createElement('p'), go = document.createElement('button');
  panel.id = 'ws-new-build'; panel.setAttribute('role', 'alertdialog'); panel.style.cssText = NEW_BUILD;
  words.textContent = 'A new build is out. Reload to play on.'; words.style.margin = '0';
  go.type = 'button'; go.textContent = 'Reload'; go.style.cssText = NEW_BUILD_BUTTON;
  scope.listen(go, 'click', () => { go.disabled = true; reload(); });
  panel.append(words, go); parent.append(panel);
  let asking = false;
  scope.interval(NEW_BUILD_RETRY_MS, () => {
    if (asking) return;
    asking = true;
    void again().finally(() => { asking = false; });
  });
}

/** J174: the small "Updating in 60s" strip. Play goes on under it, and it counts down by itself. Returns what to call when the server says so. */
export function countdownStrip(scope: Scope, parent: HTMLElement = document.body): (countdown: Countdown) => void {
  const strip = scope.ownNode(document.createElement('div'));
  strip.id = 'ws-countdown-strip'; strip.setAttribute('role', 'status'); strip.style.cssText = STYLE; strip.style.display = 'none';
  parent.append(strip);
  let left = 0, ticking = false;
  const show = (): void => { strip.textContent = `Updating in ${String(left)}s`; strip.style.display = left > 0 ? 'flex' : 'none'; };
  return countdown => {
    left = countdown.seconds; show();
    if (ticking) return;
    ticking = true;
    scope.interval(1000, () => { left = Math.max(0, left - 1); show(); });
  };
}
