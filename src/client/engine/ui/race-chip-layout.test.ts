// @vitest-environment node
// SHARD-SOURCE SS-MS1b (staging v0.1.42, 2026-11-18): on a phone the race clock, centred on the top row, ran under the minimap
// and its finish read "0:58.8 · best 0:58." (cut off). On a phone it sits under the minimap, centred, as the boss bar does, and
// never wider than the screen. happy-dom matches no media query, so this reads the real stylesheet's phone block; a headless
// Chromium at 402x874 and 375x667 put "10:58.8 · best 10:58.8" clear of the minimap and inside the screen.
// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, not a copy of it
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync('src/client/engine/ui/styles/quest.css', 'utf8');

/** The declarations of `selector` inside the `@media (max-width: 700px)` block. */
function phoneRule(selector: string): string {
  const media = css.indexOf('@media (max-width: 700px)');
  if (media === -1) throw new Error('Missing phone block');
  const block = css.slice(media), at = block.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`Missing phone rule for ${selector}`);
  return block.slice(at, block.indexOf('}', at));
}

test('on a phone the race clock sits under the minimap, inside the screen', () => {
  const rule = phoneRule('.ws-quest-race');
  expect(rule).toContain('top: calc(var(--ws-top) + 34vw + 58px)'); // the boss bar's row (boss.css), under the minimap
  expect(rule).toContain('max-width: calc(100vw - 24px)');
  expect(css).toMatch(/\.ws-quest-race\.show \{[^}]*translate\(-50%, 0\)/u); // still centred
});
