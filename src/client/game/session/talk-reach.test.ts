// @vitest-environment happy-dom
// QA-FEEDBACK-2026-11-24 row 37 (Jake, ~15:10 Cancún: "talking to the sherfiff in brasscap shoot the gun instead"). Staging, desktop
// Chromium, Brasscap, the lever-action held beside Sheriff Brass: E opened his talk, and the click that should read on fired a round
// (6 / 6 to 5 / 6) and closed the box; a click in his reach before the talk fired too. With a ranged weapon held, a click in a
// person's reach opens the talk and fires nothing, a click in the open talk reads on and fires nothing (F, the other fire key, talks
// too); out of reach the click fires, and a touch HUD keeps FIRE live (J473).
import { afterEach, expect, test } from 'vitest';
import { InputService } from '@wildshard/engine/input/InputService';
import { Scope } from '@wildshard/engine/app/scope';
import { INPUT_CONTEXTS } from '../inputContexts';
import { syncTalkReach } from './talkReach';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); document.body.replaceChildren(); });

function rifleBesideTalk(): { input: InputService; scope: Scope; shots: () => number; talks: () => number; equip: () => void } {
  const scope = new Scope('talk-reach'); owners.push(scope);
  const hud = document.createElement('div'); hud.id = 'hud'; document.body.append(hud);
  const input = new InputService(() => 10);
  for (const def of INPUT_CONTEXTS) input.register(def, scope);
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  input.install(scope, canvas);
  input.push('onFoot', scope);
  let weapon = scope.child('rifle');
  input.push('weapon.ranged', weapon);
  let shots = 0, talks = 0;
  input.bind('attack', () => { shots++; }, scope);
  input.bind('use', () => { talks++; }, scope);
  return { input, scope, shots: () => shots, talks: () => talks,
    equip: () => { weapon.dispose(); weapon = scope.child('rifle-again'); input.push('weapon.ranged', weapon); } };
}
function click(button = 0): void {
  const canvas = document.querySelector('canvas'); if (canvas === null) throw new Error('canvas');
  canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
}
function key(code: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

test('a click in a person\'s reach talks and fires nothing; out of reach the click fires', () => {
  const { input, scope, shots, talks, equip } = rifleBesideTalk();
  click();
  expect([shots(), talks()], 'no person near: the click fires').toEqual([1, 0]);
  syncTalkReach(input, scope, true);
  click();
  expect([shots(), talks()], 'beside the sheriff: the click talks').toEqual([1, 1]);
  key('KeyF');
  expect([shots(), talks()], 'F talks beside him too').toEqual([1, 2]);
  // the talk box opens over it (the dialog context) and the click reads on, still no shot
  input.push('dialog', scope);
  syncTalkReach(input, scope, true);
  click();
  expect([shots(), talks()]).toEqual([1, 3]);
  input.pop('dialog');
  // a weapon equipped in his reach goes over the talk context; the next frame puts it back on top
  equip();
  syncTalkReach(input, scope, true);
  expect(input.top).toBe('talk');
  click();
  expect([shots(), talks()]).toEqual([1, 4]);
  syncTalkReach(input, scope, false);
  click();
  expect(shots(), 'walked off: the click fires again').toBe(2);
});

test('a touch HUD keeps FIRE live beside a person (J473)', () => {
  const { input, scope, shots } = rifleBesideTalk();
  document.getElementById('hud')?.classList.add('touch');
  syncTalkReach(input, scope, true);
  input.press('attack');
  expect(shots()).toBe(1);
});
