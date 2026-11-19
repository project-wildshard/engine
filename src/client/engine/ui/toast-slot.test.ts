// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SLOT_JOIN, SLOT_LIFE, ToastStack } from './ToastStack';

// J473 row 5 (Jake, 2026-11-19 grill wave 4): "one fixed toast slot", "2.5 s each, a queue of 3", and STEP COMPLETE and the
// next OBJECTIVE are one toast (the Brasscap brazier screenshot stacked them as two).
let clock = 0;
beforeEach(() => { vi.useFakeTimers(); clock = 0; });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

const slot = (): { stack: ToastStack; box: HTMLElement; shown: () => string[] } => {
  const hud = document.createElement('div'), box = document.createElement('div');
  hud.id = 'hud'; hud.className = 'touch'; hud.append(box); document.body.append(hud);
  const stack = new ToastStack(box, () => clock);
  return { stack, box, shown: () => [...box.children].map((el) => el.textContent ?? '') };
};
const wait = (ms: number): void => { clock += ms; vi.advanceTimersByTime(ms); };

test('J473 row 5: a touch HUD shows one toast at a time, 2.5 s each, in order', () => {
  const { stack, shown } = slot();
  stack.push('Glyph shard recovered · 1 / 3');
  wait(1000);
  stack.push('Storm coming · find cover', 'warn');
  expect(shown()).toEqual(['Glyph shard recovered · 1 / 3']);
  wait(SLOT_LIFE - 1000 + 500);
  expect(shown()).toEqual(['Storm coming · find cover']);
  wait(SLOT_LIFE + 500);
  expect(shown()).toEqual([]);
});

test('J473 row 5: STEP COMPLETE and the next OBJECTIVE, said together, are one toast', () => {
  const { stack, shown } = slot();
  stack.push('Step complete · Light brazier B'); stack.push('Objective · Light brazier C');
  expect(shown()).toEqual([`Step complete · Light brazier B${SLOT_JOIN}Objective · Light brazier C`]);
  expect(stack.slotted.waiting).toEqual([]);
});

test('J473 row 5: the slot holds 3 at most; past that the oldest waiting one goes', () => {
  const { stack } = slot();
  for (const [i, text] of ['one', 'two', 'three', 'four', 'five'].entries()) { stack.push(text); if (i < 4) wait(300); }
  expect(stack.slotted).toEqual({ up: 'one', waiting: ['four', 'five'] });
});

test('a keyboard page keeps its toast column', () => {
  const box = document.createElement('div'); document.body.append(box);
  const stack = new ToastStack(box, () => clock);
  stack.push('a'); stack.push('b');
  expect([...box.children].map((el) => el.textContent)).toEqual(['a', 'b']);
});
