// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, not a copy of it
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// J473 row 7 (Jake, 2026-11-19 grill wave 4): "the tracked goal's pin shows diamond + distance only"; the tracker chip and
// the world pin both said SHERIFF (Brasscap, v0.1.50).
test('J473 row 7: on a phone the tracked goal\'s pin is the diamond and the distance', () => {
  const css = readFileSync('src/client/game/quest/presentation.css', 'utf8'), ui = readFileSync('src/client/game/plugin/ui.ts', 'utf8');
  expect(css).toContain('#hud.touch .ws-quest-pin[data-tracked] > span { display: none; }');
  expect(css).toContain(".ws-quest-pin::before { content: '◆';");
  expect(ui).toContain("root.className = 'ws-quest-pin'; root.dataset['tracked'] = '';");
});
