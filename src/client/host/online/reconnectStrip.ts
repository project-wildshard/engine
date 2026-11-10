import type { Scope } from '@wildshard/engine/app/scope';

// FM4: the plain strip that lived here is linkScreens.ts's banner and cards now (meta MMO-FAILURE-MODES-PLAN).

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
  // RL3: the panel is already full-page; the tap's own turn turns it and its button into RELOADING
  scope.listen(go, 'click', () => { go.disabled = true; go.setAttribute('aria-busy', 'true'); go.textContent = 'Reloading…'; words.textContent = 'Reloading'; reload(); });
  panel.append(words, go); parent.append(panel);
  let asking = false;
  scope.interval(NEW_BUILD_RETRY_MS, () => {
    if (asking) return;
    asking = true;
    void again().finally(() => { asking = false; });
  });
}
