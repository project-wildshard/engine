import type { Scope } from '@wildshard/engine/app/scope';
import { listenTap } from '@wildshard/engine/input/dom';
import { mountUi } from '@wildshard/engine/ui/ownership';
import { FIRST_PLAY_EVENT, finishFirstPlay, firstPlayPending, takeFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { lowPowerOn, lowPowerRefusal, PIXELS_EVENT, type GraphicsMode } from '@wildshard/engine/core/graphicsMode';
import { applyPreset, modeLine, presetLabel, PROTO_EVENT, worldToggleOn } from '@wildshard/engine/core/graphicsQuality';
import './firstPlay.css';

/**
 * MOBILE-GRAPHICS MG5 / MG6 (Jake, 2026-11-10: "I think we should have a first-time play screen… unique per device, you have to
 * enter Driftwood. And you have to be told about low power mode, low graphics, high graphics… toggle between low and high
 * graphics in Driftwood… first time only… And it should be something in settings that allows me to… clear the first time
 * thing and go back to the first time flow").
 *
 * MG9 (Jake, ~21:45: "if the high-low model could be made smaller… 33% transparency always, but when you press the buttons it
 * goes to 90% and then it fades back over 10 seconds to 33%"; ~23:20, of prototype A: "my spec, smaller card, rest of 33, jumps
 * to 90. Yep, GG, approved."). The in-world toggle is that card: a title, Low | High, one line, Done. The whole card rests at
 * REST_OPACITY; a touch takes it to PEAK_OPACITY at once, then it fades back over FADE_MS (it opens at the peak too).
 *
 * It shows once the player has control: on a phone's first PLAY with no `firstPlayDone` mark (the title skips SHARD SELECT for
 * Driftwood, mainMenu.ts), and on every entry while Settings ▸ Graphics ▸ In-world toggle is on. Low or High applies that preset
 * to every Graphics control (MG8, graphicsQuality.ts); on Custom neither is lit and the line says so. MG3's Low Power lock
 * holds (a refused High says why). DONE marks the device; Settings ▸ Replay first-time setup clears the mark (MG6).
 */

export const REST_OPACITY = 0.33;
export const PEAK_OPACITY = 0.9;
export const FADE_MS = 10_000;
/** the event that takes the toggle down without marking the device (Settings turned the in-world toggle off) */
const CLOSE_EVENT = 'ws:gfx-toggle-close';
const COPY = {
  title: 'Graphics',
  custom: 'Custom: your own mix in Settings ▸ Graphics. Tap Low or High to use a preset.',
  done: 'Done',
} as const;

/** Show the toggle once the player has control in `slug`: on a first play the title armed for it (as control arrives, or at
 *  once for a shard already in control; the intent is spent on showing), or whenever Settings' In-world toggle is on. */
export function installFirstPlay(scope: Scope, root: HTMLElement, slug: string): void {
  let controlled = false, card: HTMLElement | null = null;
  const maybe = (): void => {
    if (card !== null || !controlled || scope.disposed || (!worldToggleOn() && !firstPlayPending(slug))) return;
    takeFirstPlay(); card = showToggle(scope, root, () => { card = null; });
  };
  scope.listen(document, 'ws:control-ready', () => { controlled = true; maybe(); });
  scope.listen(document, FIRST_PLAY_EVENT, maybe);
  // Settings ▸ Graphics ▸ In-world toggle: on shows it now; off takes it down (a pending first play keeps it)
  scope.listen(document, PROTO_EVENT, () => {
    if (!worldToggleOn() && card !== null && !firstPlayPending(slug)) { const old = card; card = null; old.dispatchEvent(new CustomEvent(CLOSE_EVENT)); }
    maybe();
  });
}

/** The toggle, in a scope of its own that DONE disposes (exported for its test and the worst-case HUD). */
export function showToggle(parent: Scope, root: HTMLElement, closed: () => void = () => undefined): HTMLElement {
  const scope = parent.child('gfx-toggle');
  const el = (tag: string, cls: string, text = ''): HTMLElement => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n; };
  const box = el('section', 'ws-firstplay-v ws-firstplay-va');
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', COPY.title);
  const buttons = new Map<GraphicsMode, HTMLButtonElement>();
  const seg = el('div', 'ws-firstplay-vseg');
  for (const mode of ['low', 'high'] as const) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset['v'] = mode; b.textContent = mode === 'low' ? 'Low' : 'High';
    seg.append(b); buttons.set(mode, b);
  }
  const line = el('p', 'ws-firstplay-vline');
  const finish = el('button', 'ws-firstplay-vdone', COPY.done) as HTMLButtonElement; finish.type = 'button';
  let refused = false;
  const paint = (): void => {
    if (!lowPowerOn()) refused = false;
    const mode = presetLabel();
    for (const [key, b] of buttons) b.setAttribute('aria-pressed', String(key === mode));
    line.textContent = refused || lowPowerOn() ? lowPowerRefusal() : mode === 'custom' ? COPY.custom : modeLine(mode);
    line.dataset['tone'] = refused ? 'refused' : lowPowerOn() ? 'on' : 'off';
    box.dataset['mode'] = mode;
  };
  // faint at rest; a touch brings it up to the peak at once, and it fades back over FADE_MS
  const flash = (): void => {
    box.style.transition = 'none'; box.style.opacity = String(PEAK_OPACITY);
    void box.offsetWidth; // the peak lands before the fade starts
    box.style.transition = `opacity ${String(FADE_MS)}ms linear`; box.style.opacity = String(REST_OPACITY);
  };
  for (const [mode, b] of buttons) listenTap(scope, b, () => { refused = !applyPreset(mode); paint(); flash(); });
  listenTap(scope, finish, () => { finishFirstPlay(); scope.dispose(); closed(); });
  scope.listen(box, CLOSE_EVENT, () => { scope.dispose(); });
  box.append(el('h2', 'ws-firstplay-vtitle', COPY.title), seg, line, finish);
  scope.listen(box, 'pointerdown', (event: Event) => { flash(); event.stopPropagation(); }); // its touches are its own: the look surface never sees them
  scope.listen(document, PIXELS_EVENT, () => { paint(); });
  scope.interval(1000, () => { paint(); });
  paint();
  mountUi(box, scope, root);
  box.style.opacity = String(PEAK_OPACITY); scope.raf(() => { flash(); });
  return box;
}
