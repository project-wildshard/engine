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
  return { stack, box, shown: () => [...box.children].map((el) => el.firstChild?.textContent ?? '') }; // the line, not its +N chip
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

// HUD Tidy HT2 (Jake picked A, 11-24 ~14:55: "no big card, it becomes a line under the boss bar. and it can take turns"): a pickup
// and a quest step said in the same second both show, one after the other, and the line up counts the ones waiting
test('HT2: a pickup and a quest step in the same second take turns, with a +N for the one waiting', () => {
  const { stack, shown } = slot();
  stack.push('Picked up · Sea glass · Charm · 5', 'pickup');
  stack.push('Glyph shard recovered · 1 / 3');
  expect(stack.slotted).toEqual({ up: 'Picked up · Sea glass · Charm · 5', waiting: ['Glyph shard recovered · 1 / 3'] });
  expect(stack.more).toBe('+1');
  expect(shown()).toEqual(['Picked up · Sea glass · Charm · 5']);
  wait(SLOT_LIFE + 500);
  expect(shown()).toEqual(['Glyph shard recovered · 1 / 3']);
  expect(stack.more).toBe('');
  wait(SLOT_LIFE + 500);
  expect(shown()).toEqual([]);
});

// HUD Tidy HT1 (Jake 11-24 ~14:35): GET LOW is a line in the same slot; it jumps the queue and holds while the lightning is near
test('HT1: GET LOW jumps the queue, holds while pinned, and the line it cut short comes back', () => {
  const { stack, shown, box } = slot();
  stack.push('Picked up · Sea glass', 'pickup');
  stack.push('Objective · Light the signal fire');
  wait(1000);
  stack.pin('Lightning — get low');
  expect(shown()).toEqual(['Lightning — get low']); expect(stack.more).toBe('+2');
  expect(box.firstElementChild?.classList.contains('ws-game-toast-warn')).toBe(true);
  wait(SLOT_LIFE * 3);
  expect(stack.slotted.up).toBe('Lightning — get low'); // held while the lightning is near
  stack.pin(null);
  wait(500);
  expect(stack.slotted).toEqual({ up: 'Picked up · Sea glass', waiting: ['Objective · Light the signal fire'] });
  wait(SLOT_LIFE + 500);
  expect(stack.slotted.up).toBe('Objective · Light the signal fire');
});

test('HT1: a pin shown under 2.5 s stays its 2.5 s after it is lifted; a keyboard column ignores pins', () => {
  const { stack } = slot();
  stack.pin('Lightning — get low'); wait(1000); stack.pin(null);
  expect(stack.slotted.up).toBe('Lightning — get low');
  wait(SLOT_LIFE - 1000 + 500);
  expect(stack.slotted.up).toBeNull();
  const column = document.createElement('div'); document.body.append(column);
  const keys = new ToastStack(column, () => clock);
  keys.pin('Lightning — get low');
  expect(column.children.length).toBe(0);
});
