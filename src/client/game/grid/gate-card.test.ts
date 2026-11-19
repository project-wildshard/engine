// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { GateCard } from './gateCard';

// QA 11-19 row 53 (Jake, 16:12 Cancún: "it needs to float like a fixed distance away from your face, no matter which way you're
// looking ... when you walk up to the wall, you can no longer see it"): the gate card is a screen overlay for the whole count.
// It takes no camera, so no view direction or distance to the wall can move, shrink or hide it.
// The stylesheet's screen place is pinned by test/gate-card-css.test.ts.
let scope = new Scope('gate-card.test');
afterEach(() => { scope.dispose(); scope = new Scope('gate-card.test'); document.body.replaceChildren(); });

it('shows the whole count at one screen place, with no per-frame pin', () => {
  const card = new GateCard(scope);
  for (const count of [5, 4, 3, 2, 1]) {
    card.show({ name: 'Driftwood Isle', count });
    expect(card.root.hidden).toBe(false);
    expect(card.text).toBe(`Driftwood Isle ${String(count)}`);
    expect(card.root.style.transform).toBe(''); // nothing projected through the camera: the stylesheet places it
  }
  expect(card.root.querySelector<HTMLElement>('.ws-gate-line')?.textContent).toBe('Preparing to enter');
});

it('a reason stands alone in place of the count, and null hides the card', () => {
  const card = new GateCard(scope);
  card.show({ name: 'Nalati', count: 5, reason: 'Not downloaded' });
  expect(card.text).toBe('Nalati Not downloaded');
  expect(card.root.querySelector<HTMLElement>('.ws-gate-line')?.hidden).toBe(true);
  card.show(null);
  expect(card.root.hidden).toBe(true);
  expect(card.text).toBeNull();
});
