// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { progressOfCard } from '@wildshard/engine/boot/stuckStep';
import { confirmPhoneMemory } from './phoneMemoryWarning';

test('the boot watchdog recognizes the player wait until Play anyway', async () => {
  const scope = new Scope('phone-memory-test'), root = document.createElement('main');
  document.body.append(root);
  try {
    const continued = vi.fn();
    const confirmation = confirmPhoneMemory(root, scope);
    void confirmation.then(continued, () => undefined);
    const card = root.querySelector('dialog');
    expect(card?.open).toBe(true);
    expect(card?.querySelector('h1')?.textContent).toBe('This world may crash this phone');
    expect(progressOfCard(root, document).player).toBe(true);
    expect(continued).not.toHaveBeenCalled();
    const play = card?.querySelector('button');
    expect(play?.textContent).toBe('Play anyway');
    play?.click();
    await confirmation;
    expect(continued).toHaveBeenCalledTimes(1);
    expect(root.querySelector('dialog')).toBeNull();
    expect(progressOfCard(root, document).player).toBe(false);
  } finally {
    scope.dispose();
    root.remove();
  }
});
