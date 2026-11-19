// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, not a copy of it
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// J473 row 6 (Jake, 2026-11-19 grill wave 4): the tracker is one line under the map, 60% max, the name ellipsised, the
// distance always shown, and a swap never draws the old label under the new one.
const css = readFileSync('src/client/engine/ui/styles/quest.css', 'utf8');
const rule = (selector: string): string => css.split('\n').find((line) => line.startsWith(`${selector} {`))?.slice(selector.length + 2) ?? '';

test('J473 row 6: the phone tracker is one line, 60% wide at most, clipped at its edge', () => {
  expect(rule('#hud.touch .ws-quest-obj')).toContain('max-width: 60vw; overflow: hidden;');
  expect(css).toMatch(/\.ws-quest-obj \{[^}]*white-space: nowrap/u);
  // the name ellipsises; the count and the distance never shrink
  expect(rule('.ws-quest-obj-label, .ws-quest-obj-name')).toContain('text-overflow: ellipsis');
  expect(rule('.ws-quest-obj-count, .ws-quest-obj-dist')).toContain('flex: none');
  // a chip that yields leaves at once, so two goals never draw in one spot
  expect(rule('.ws-quest-obj.ws-quest-yield')).toContain('display: none');
});
