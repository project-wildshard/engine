import type { Scope } from '@wildshard/engine/app/scope';
import { engineString } from '@wildshard/engine/strings';
import { listenTap } from '@wildshard/engine/input/dom';
import { mountUi } from '@wildshard/engine/ui/ownership';

/** J431: an estimated phone overage waits for the player before the world starts. */
export function confirmPhoneMemory(root: HTMLElement, scope: Scope): Promise<void> {
  const warning = document.createElement('dialog');
  warning.className = 'ws-load-memory-warning';
  warning.dataset['bootWait'] = 'player';
  warning.setAttribute('aria-labelledby', 'ws-load-memory-title');
  const title = document.createElement('h1');
  title.id = 'ws-load-memory-title';
  title.textContent = engineString('s_loading_memory_risk');
  const play = document.createElement('button');
  play.type = 'button'; play.className = 'ws-load-play'; play.textContent = engineString('s_loading_play_anyway');
  warning.append(title, play);
  const owner = scope.child('phone memory warning');
  return new Promise<void>((resolve, reject) => {
    owner.onDispose(() => { reject(new DOMException('Loading was disposed before Play anyway', 'AbortError')); });
    owner.listen(warning, 'cancel', event => { event.preventDefault(); });
    listenTap(owner, play, () => { resolve(); warning.close(); owner.dispose(); });
    mountUi(warning, owner, root);
    warning.showModal();
    play.focus();
  });
}
