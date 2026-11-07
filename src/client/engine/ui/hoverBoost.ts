import type { Scope } from '../../../shared/engine/app/scope';
import type { Events } from '../../../shared/engine/events/events';
import { isDev, onDev } from '../core/devMode';
import { engineString } from '../../../shared/engine/strings';

/** The shared board HUD needs only the hover state and the Developer boost latch. */
interface HoverBoostPort { hover: boolean; hoverBoost: boolean }

/** G540: a live Developer-only toggle beside HOVER; it never consumes a move/look gesture. */
export function mountHoverBoost(root: HTMLElement, player: HoverBoostPort, events: Events, scope: Scope): void {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'ws-touch-boost'; button.hidden = true;
  button.textContent = engineString('s_hover_boost');
  button.setAttribute('aria-label', engineString('s_hover_boost_label'));
  const sync = (): void => {
    button.hidden = !isDev() || !player.hover;
    button.classList.toggle('on', player.hoverBoost);
    button.setAttribute('aria-pressed', String(player.hoverBoost));
  };
  scope.listen(button, 'pointerdown', (event) => {
    event.stopPropagation(); event.preventDefault();
    if (!isDev() || !player.hover) return;
    player.hoverBoost = !player.hoverBoost; sync();
  });
  scope.listen(button, 'pointerup', event => { event.stopPropagation(); });
  events.on('player.hover', sync, scope);
  scope.onDispose(onDev(sync));
  root.append(button); sync();
  scope.onDispose(() => { button.remove(); });
}
