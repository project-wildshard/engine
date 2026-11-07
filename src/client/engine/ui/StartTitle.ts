import { pageScope } from '../../../shared/engine/app/resources';
import { HudSlots } from './hudSlots';
import { engineString } from '../../../shared/engine/strings';
import { onDev } from '../core/devMode';
/** Renderer-free opening title: the shared title deck (src/client/game/titleDeck.ts, E318 — the same deck "Exit to main" shows).
 *  Only the selected shard's hero art is decoded. The entry hands in the deck builder (E405: the engine imports no game). */
import { previousBootLine } from '../boot/bootTrace';
import type { TitleDeckView } from './HUD';

/** builds the deck: every card opens its level in a fresh page; `notice` says why the last boot came back here */
export type StartTitleDeck = (opts: { settings: () => void; notice?: string }) => TitleDeckView;

/** Present the supplied title deck while the entry prepares. */
export function showStartTitle(buildDeck: StartTitleDeck): void {
  const scope = pageScope.child('ui.StartTitle'), slots = new HudSlots();
  const hud = document.getElementById('hud');
  if (hud === null) throw new Error('Start title: missing #hud');
  hud.classList.add('intro');
  const interrupted = previousBootLine();
  let deck: TitleDeckView | undefined;
  const refresh = (): void => {
    const selected = deck?.cards[deck.index]?.slug;
    deck?.root.remove(); deck?.dispose();
    deck = buildDeck({
      settings: () => { void import('./BootSettings').then(({ openBootSettings }) => openBootSettings()); },
      ...(interrupted ? { notice: `${interrupted}\n${engineString('s_returned_to_select')}` } : {}),
    });
    slots.widget('band.1', deck.root, 0, scope, hud);
    const index = deck.cards.map((card): string => card.slug).indexOf(selected ?? '');
    if (index !== -1) deck.select(index, false);
    deck.start();
    document.querySelector('[data-title-shell]')?.remove();
    performance.mark('wildshard.title'); // MF3: the live title is up (the Simulator bar reads it)
  };
  refresh();
  scope.onDispose(onDev(refresh));
  scope.onDispose(() => { deck?.dispose(); });
  document.dispatchEvent(new Event('ws:ready'));
}
