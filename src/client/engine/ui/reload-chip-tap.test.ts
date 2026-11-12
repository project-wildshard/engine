// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { listenReloadChip } from './reloadChip';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); document.body.replaceChildren(); });

/** The touch layer as TouchControls builds it (E46): it cancels its own touchstart / touchmove / touchend, so a tap on
 *  anything inside it never becomes a click; only pointer events arrive. The chip sits in its status column. */
function board(): { chip: HTMLButtonElement; presses: () => number; looks: () => number } {
  const scope = new Scope('reload chip'); owners.push(scope);
  const layer = document.createElement('div'), status = document.createElement('div'), chip = document.createElement('button');
  layer.className = 'ws-touch'; chip.type = 'button'; chip.className = 'ws-game-bolts magazine';
  status.append(chip); layer.append(status); document.body.append(layer);
  chip.getBoundingClientRect = () => new DOMRect(12, 100, 200, 24); // the strip's box on a 402 px phone
  const cancel = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
  for (const t of ['touchstart', 'touchmove', 'touchend']) scope.listen(layer, t, cancel, { passive: false });
  let looks = 0; scope.listen(layer, 'pointerdown', () => { looks++; });
  let presses = 0; listenReloadChip(scope, chip, () => { presses++; });
  return { chip, presses: () => presses, looks: () => looks };
}
const pointer = (type: string, x = 40, y = 110, pointerId = 7): PointerEvent =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y });

test('TE-ENG5: a touch tap on the Rounds chip reloads, with no click (the layer cancels touchend)', () => {
  const b = board();
  b.chip.dispatchEvent(pointer('pointerdown')); b.chip.dispatchEvent(pointer('pointerup'));
  expect(b.presses()).toBe(1);
  expect(b.looks()).toBe(0); // the press never starts a look drag or a fire on the layer underneath
});

test('TE-ENG5: a pointer tap whose click does follow presses once, and a keyboard click still presses', () => {
  const b = board();
  b.chip.dispatchEvent(pointer('pointerdown')); b.chip.dispatchEvent(pointer('pointerup'));
  b.chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 110 }));
  expect(b.presses()).toBe(1);
  b.chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); // Enter (InputService takes Space for the game)
  expect(b.presses()).toBe(2);
});

test('TE-ENG5: a disabled chip (full, reloading or no reserve) ignores a tap', () => {
  const b = board(); b.chip.disabled = true;
  b.chip.dispatchEvent(pointer('pointerdown')); b.chip.dispatchEvent(pointer('pointerup'));
  expect(b.presses()).toBe(0);
});

test('TE-ENG5: a release that is no tap on the chip does not reload', () => {
  const b = board();
  b.chip.dispatchEvent(pointer('pointerup', 40, 110, 9)); // a press that began elsewhere, lifted over the chip
  b.chip.dispatchEvent(pointer('pointerdown')); b.chip.dispatchEvent(pointer('pointerup', 300, 500)); // dragged off (captured)
  b.chip.dispatchEvent(pointer('pointerdown')); b.chip.dispatchEvent(pointer('pointercancel')); b.chip.dispatchEvent(pointer('pointerup'));
  expect(b.presses()).toBe(0);
  b.chip.dispatchEvent(pointer('pointerdown')); b.chip.dispatchEvent(pointer('pointerup'));
  expect(b.presses()).toBe(1);
});
