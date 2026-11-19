import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// QA 11-19 row 53 (Jake, 16:12 Cancún: "a fixed distance away from your face, no matter which way you're looking"): the gate
// card's stylesheet places it on the screen above the crosshair; src/client/game/grid/gate-card.test.ts pins that nothing
// projects it through the camera.
it('the stylesheet locks the gate card to the screen above the crosshair', () => {
  const css = readFileSync('src/client/game/grid/gateCard.css', 'utf8');
  const rule = /\.ws-gate-card \{([^}]*)\}/u.exec(css)?.[1] ?? '';
  expect(rule).toMatch(/position: fixed;/u);
  expect(rule).toMatch(/left: 50%;/u);
  expect(rule).toMatch(/transform: translateX\(-50%\);/u);
  expect(rule).toMatch(/top: max\(22%/u);
});
