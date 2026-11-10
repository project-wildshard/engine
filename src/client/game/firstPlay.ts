import type { Scope } from '@wildshard/engine/app/scope';
import { listenTap } from '@wildshard/engine/input/dom';
import { mountUi } from '@wildshard/engine/ui/ownership';
import { FIRST_PLAY_EVENT, finishFirstPlay, firstPlayPending, takeFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { graphicsMode, lowPowerOn, lowPowerRefusal, PIXELS_EVENT, saveGraphicsMode, type GraphicsMode } from '@wildshard/engine/core/graphicsMode';
import './firstPlay.css';

/**
 * MOBILE-GRAPHICS MG5 / MG6 (Jake, 2026-11-10: "I think we should have a first-time play screen… unique per device, you have to
 * enter Driftwood. And you have to be told about low power mode, low graphics, high graphics, how you have to turn low power
 * mode off if you want to play high graphics… toggle between low and high graphics in Driftwood… first time only… And it
 * should be something in settings that allows me to… clear the first time thing and go back to the first time flow").
 *
 * A phone's first PLAY with no `firstPlayDone` mark skips SHARD SELECT for the deck's first card, Driftwood (mainMenu.ts); once the
 * player has control, a card says what Low and High mean and that Low Power Mode forces Low, with a Low / High toggle that
 * applies in the next drawn frame (graphicsMode.ts, MG3's lock included). DONE marks the device; later plays go through SHARD
 * SELECT. Settings ▸ Replay first-time setup clears the mark (BootSettings.ts, MG6).
 */


const COPY = {
  kicker: 'First play · this device',
  title: 'Low or High graphics',
  low: 'Low draws one pixel per screen point: smoother, softer.',
  high: 'High draws twice as many each way: sharper, and harder on the battery.',
  power: 'Low Power Mode keeps you on Low. Turn it off in Settings ▸ Battery to use High.',
  done: 'Done',
} as const;

/** Show the card once the player has control in `slug`, when the title armed a first play for it: as control arrives, or at
 *  once when the title arms one for a shard already in control (a resident level re-entered). The intent is spent on showing. */
export function installFirstPlay(scope: Scope, root: HTMLElement, slug: string): void {
  let controlled = false, card: HTMLElement | null = null;
  const maybe = (): void => {
    if (card !== null || !controlled || scope.disposed || !firstPlayPending(slug)) return;
    takeFirstPlay(); card = showFirstPlayCard(scope, root, () => { card = null; });
  };
  scope.listen(document, 'ws:control-ready', () => { controlled = true; maybe(); });
  scope.listen(document, FIRST_PLAY_EVENT, maybe);
}

/** The card itself, in a scope of its own that DONE disposes (exported for its test and the worst-case HUD). */
export function showFirstPlayCard(parent: Scope, root: HTMLElement, closed: () => void = () => undefined): HTMLElement {
  const scope = parent.child('first-play');
  const card = document.createElement('section');
  card.className = 'ws-firstplay'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', COPY.title);
  const line = (tag: string, cls: string, text: string): HTMLElement => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n; };
  const seg = document.createElement('div'); seg.className = 'ws-firstplay-seg'; seg.setAttribute('role', 'group');
  const buttons = new Map<GraphicsMode, HTMLButtonElement>();
  for (const mode of ['low', 'high'] as const) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset['v'] = mode; b.textContent = mode === 'low' ? 'Low' : 'High';
    seg.append(b); buttons.set(mode, b);
  }
  const note = line('p', 'ws-firstplay-note', '');
  const finish = document.createElement('button'); finish.type = 'button'; finish.className = 'ws-firstplay-done'; finish.textContent = COPY.done;
  card.append(line('i', 'ws-firstplay-kicker', COPY.kicker), line('h2', 'ws-firstplay-title', COPY.title), seg,
    line('p', 'ws-firstplay-text', COPY.low), line('p', 'ws-firstplay-text', COPY.high), note, finish);
  // a refused High says so until the next pick that holds, or until Low Power goes (then High is the player's again)
  let refused = false;
  const paint = (): void => {
    if (!lowPowerOn()) refused = false;
    const mode = graphicsMode();
    for (const [key, b] of buttons) b.setAttribute('aria-pressed', String(key === mode));
    note.textContent = refused || lowPowerOn() ? lowPowerRefusal() : COPY.power;
    note.dataset['tone'] = refused ? 'refused' : lowPowerOn() ? 'on' : 'off';
  };
  for (const [mode, b] of buttons) listenTap(scope, b, () => { refused = !saveGraphicsMode(mode); paint(); });
  listenTap(scope, finish, () => { finishFirstPlay(); scope.dispose(); closed(); });
  // the card takes its own touches: the look surface under it never sees them
  scope.listen(card, 'pointerdown', (event: Event) => { event.stopPropagation(); });
  // the Low Power reading can land, lapse or flip while the card is up: it follows the mode in force
  scope.listen(document, PIXELS_EVENT, () => { paint(); });
  scope.interval(1000, () => { paint(); });
  paint();
  mountUi(card, scope, root);
  return card;
}
