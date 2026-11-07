import { resourceScope } from '../../../shared/engine/app/resources';
import { saveStorage } from '../saves/slots';

const savedStorage = saveStorage('device');
/**
 * Developer mode (E140, the user's 1c): one switch that shows the screens only a developer or a playtester wants — the frame
 * meter, the build id pill, the loading screen's step log, the Settings DEBUG card. Players see none of them.
 *
 *   isDev()            // on for this page?
 *   setDev(on)         // the Settings ▸ Developer switch: saved, and every listener told at once (no reload)
 *   onDev((on) => …)   // live show / hide; returns the unsubscribe
 *
 * The saved pick lives in the device document's `devMode` key and stays on this machine.
 * No URL switch (E162: the test scripts set `devMode` before load). `<html data-dev>` mirrors the state for CSS — index.html
 * sets it before any module runs (the loading screen is painted from the first bytes), from this same key; keep the two
 * readers in step.
 */
const KEY = 'devMode';
const EVENT = 'ws-dev';

const saved = (): boolean => { try { return savedStorage.getItem(KEY) === '1'; } catch { return false; } };

let on = saved();

// a Node bake script may stub document without documentElement (CI bake-check crashed here)
const mirror = (): void => {
  if (typeof document === 'undefined') return;
  try { document.documentElement.toggleAttribute('data-dev', on); } catch { /* a stub document with no root element */ }
};
mirror();

export function isDev(): boolean { return on; }

export function setDev(next: boolean): void {
  try { if (next) savedStorage.setItem(KEY, '1'); else savedStorage.removeItem(KEY); } catch { /* private mode: this load only */ }
  if (next === on) return;
  on = next;
  mirror();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

/** Browser mode changes are scoped; headless consumers have no DOM event source to subscribe to. */
export function onDev(fn: (on: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
  const scope = resourceScope();
  const h = (): void => { fn(on); };
  scope.listen(window, EVENT, h);
  return () => { scope.unlisten(window, EVENT, h); };
}
