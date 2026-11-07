import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { awaitDressingTextures } from './sceneDressing';

test('the dressing waits for every declared texture before it resolves', async () => {
  const scope = new Scope('dressing textures');
  let done = false, finish = (): void => undefined;
  const slow = new Promise<void>(resolve => { finish = resolve; });
  const wait = (async (): Promise<void> => { await awaitDressingTextures(scope, [Promise.resolve(), slow]); done = true; })();
  await Promise.resolve(); expect(done).toBe(false);
  finish(); await wait; expect(done).toBe(true);
  scope.dispose();
});

test('retiring the dressing ends a wait that never settles and refuses it', async () => {
  const scope = new Scope('dressing retired'), never = new Promise<void>(() => { /* never settles */ });
  const wait = awaitDressingTextures(scope, [never]);
  scope.dispose();
  await expect(wait).rejects.toThrow('retired');
});
