import type { Scope } from '@wildshard/engine/app/scope';
import { listenTap } from '@wildshard/engine/input/dom';
import { mountUi } from '@wildshard/engine/ui/ownership';
import { finishFirstPlay, firstPlayPending } from '@wildshard/engine/boot/firstPlayMark';
import { graphicsMode, lowPowerOn, lowPowerRefusal, saveGraphicsMode, type GraphicsMode } from '@wildshard/engine/render/graphicsMode';
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

/** Show the card once the player has control, if the title started a first play. */
export function installFirstPlay(scope: Scope, root: HTMLElement): void {
  if (!firstPlayPending()) return;
  scope.listen(document, 'ws:control-ready', () => { showFirstPlayCard(scope, root); }, { once: true });
}

/** The card itself (exported for its test and the worst-case HUD). */
export function showFirstPlayCard(scope: Scope, root: HTMLElement): HTMLElement {
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
  const paint = (refused = false): void => {
    const mode = graphicsMode();
    for (const [key, b] of buttons) b.setAttribute('aria-pressed', String(key === mode));
    note.textContent = refused || lowPowerOn() ? lowPowerRefusal() : COPY.power;
    note.dataset['tone'] = refused ? 'refused' : lowPowerOn() ? 'on' : 'off';
  };
  for (const [mode, b] of buttons) listenTap(scope, b, () => { paint(!saveGraphicsMode(mode)); });
  listenTap(scope, finish, () => {
    finishFirstPlay(); card.remove();
  });
  // the card takes its own touches: the look surface under it never sees them
  scope.listen(card, 'pointerdown', (event: Event) => { event.stopPropagation(); });
  paint();
  mountUi(card, scope, root);
  return card;
}
