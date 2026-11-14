// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { askNameToJoin, nameAskDue } from './namePrompt';

// OFFLINE OF11 (J298): a fresh device entering the world offline isn't held at Worker boot by the Name prompt.
const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); document.body.replaceChildren(); });
const scope = (): Scope => { const made = new Scope('name-join'); scopes.push(made); return made; };

test('OF11: offline, the join goes on as Skip would and the device is still asked on its next online join', async () => {
  expect(nameAskDue()).toBe(true);
  expect(await askNameToJoin(scope(), { parent: document.body }, false)).toBe(true);
  expect(document.querySelector('#ws-name-box'), 'no prompt').toBeNull();
  expect(nameAskDue(), 'not marked asked').toBe(true);
  const online = askNameToJoin(scope(), { parent: document.body }, true);
  expect(document.querySelector('#ws-name-box'), 'online, the prompt shows').not.toBeNull();
  scopes[1]?.dispose();
  expect(await online).toBe(false);
});
